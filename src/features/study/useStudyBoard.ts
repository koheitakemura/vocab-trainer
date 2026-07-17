import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CourseType, VocabCard } from '../../types'
import { db } from '../../store/db'
import { localDate, recordReview, resetCourseProgress } from '../../store/progress'
import { approxLevelCounts, emptyLevelCounts, gradeLevel, isPromotionToKnown, type GradeLevel } from '../../srs/levels'
import { shouldClozePromote } from '../../srs/cloze'
import type { ReviewGrade } from '../../srs/scheduler'

/** レール型は1セッションの新規語を絞る（完走率のため。PLAN §4.1） */
const NEW_PER_SESSION = 16

export type TileState = 'pending' | 'again' | 'done'
export interface BoardTile {
  card: VocabCard
  state: TileState
  /** 直近に押したボタンの評価（未採点は undefined）。カードの枠線・点の色・ラベル用。 */
  grade?: ReviewGrade
  /** レベル別の累計採点回数（丸表示用）。一度も採点していないカードは undefined。 */
  levelCounts?: Record<GradeLevel, number>
  /**
   * このカードを文脈クローズ提示へ昇格するか（PLAN §4.2）。cloze/較正コースで、安定した既習語のみ true。
   * 未習・学習中の新規カードは常に false（まず語を覚える）。rail コースでは常に false。
   */
  clozePromoted?: boolean
}

/** grade() の結果（演出とヘッダーのメーター追従・コーチ文の解禁判定の材料） */
export interface GradeOutcome {
  /** きらきら演出を出すか（初採点 or Fuzzy/Studying → I know の前進 or 卒業） */
  sparkle: boolean
  /** 金色スパークル（卒業＝Mastered 到達） */
  gold: boolean
  /** 推定語彙数（retrievability 合計）の増分 */
  deltaR: number
  /** 採点したカード */
  cardId: string
  /** この採点で「I know」扱いになったか（good/easy） */
  known: boolean
}

/**
 * Study Grid（案①）用のセッション。
 * due の学習中 + 新規 N 語を「ボード」として一括表示する。
 * どのタイルをめくる/採点するかは各タイル側（ホバー・クリック）が自律的に決め、
 * ボード側は「自動で次のカードへ進める」ような遷移は行わない（Kohei の要望どおり）。
 *
 * セッション構築はコースの progress 行だけをインデックススキャンする（v2: 「行が無い ＝ 未着手」）。
 * コストは学習済み語数に比例＝語彙が3万語に増えても未学習分は一切読まない。
 * （旧実装の「開くたびに全語彙分 getOrCreateProgress」が最重量の起動待ちだった）
 */
export function useStudyBoard(cards: VocabCard[], courseType: CourseType) {
  const [tiles, setTiles] = useState<BoardTile[]>([])
  const [pendingQueue, setPendingQueue] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewed, setReviewed] = useState(0)
  const [again, setAgain] = useState(0)
  const [nonce, setNonce] = useState(0)
  // pendingQueue の同期ミラー。grade() は await を挟むため、state のクロージャだけに頼ると
  // 連打（再レンダー前の2打目）で1打目のキュー除去が巻き戻る＝セッションが完了不能になる。
  const queueRef = useRef<string[]>([])
  // 新規語の表示窓の開始位置。restart（Start another session）を押すたびに前へ進めて
  // 「未採点のまま押しても同じ16枚が出る」を防ぐ。総数で剰余＝一周したら先頭へ戻り取りこぼしなし。
  const newOffsetRef = useRef(0)
  const prevCardsRef = useRef(cards)

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  useEffect(() => {
    let active = true
    // コース（cards）が変わったら窓を先頭へ戻す
    if (prevCardsRef.current !== cards) {
      prevCardsRef.current = cards
      newOffsetRef.current = 0
    }
    void (async () => {
      setLoading(true)
      const courseId = cards[0]?.courseId
      const rows = courseId ? await db.progress.where('courseId').equals(courseId).toArray() : []
      const progressById = new Map(rows.map((r) => [r.cardId, r]))
      const now = Date.now()
      const today = localDate(new Date(now))
      const reviewTiles: BoardTile[] = []
      const newCandidates: VocabCard[] = []
      for (const card of cards) {
        const r = progressById.get(card.id)
        if (!r || r.status === 'new') {
          newCandidates.push(card)
        } else if (
          r.status !== 'burned' &&
          r.status !== 'suspended' &&
          r.fsrs.due.getTime() <= now &&
          // 今日すでにボタンを押した（採点した）語は、更新／Start another session の後は出さない。
          // FSRS の期限が同日中でも「今日はもう終わり」にする（Kohei 指定）。
          (!r.lastReviewedAt || localDate(new Date(r.lastReviewedAt)) !== today)
        ) {
          reviewTiles.push({
            card,
            state: 'pending',
            grade: r.lastGrade,
            levelCounts: approxLevelCounts(r),
            clozePromoted: shouldClozePromote(courseType, r.fsrs),
          })
        }
      }
      const total = newCandidates.length
      const start = total > 0 ? newOffsetRef.current % total : 0
      const newTiles: BoardTile[] = []
      for (let i = 0; i < Math.min(NEW_PER_SESSION, total); i++) {
        // 未習語だけ "New" 表示（grade 未設定）＝初採点でスパークルが発火する。
        newTiles.push({ card: newCandidates[(start + i) % total], state: 'pending' })
      }
      // 復習（期限到来）はアプリを開いた最初の盤面（offset 0）だけに載せる。
      // 「Start another session」を押した後（offset > 0）は復習を持ち越さず、
      // 未習語だけの完全に新しい16枚に入れ替える（Kohei 指定＝全カードが変わる）。
      // ただし未習語が尽きたコースでは復習が唯一の学習対象なので常に載せる。
      const includeReviews = newOffsetRef.current === 0 || newCandidates.length === 0
      const sessionTiles = includeReviews ? [...reviewTiles, ...newTiles] : newTiles
      if (!active) return
      setTiles(sessionTiles)
      queueRef.current = sessionTiles.map((t) => t.card.id)
      setPendingQueue(queueRef.current)
      setReviewed(0)
      setAgain(0)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [cards, nonce, courseType])

  /**
   * id を明示指定して採点する。どのカードも採点後にボタンが残り、いつでも採点しなおせる。
   * 色・マークは初回でも再採点でも毎回更新する。完了判定用のキューは「まだ一度も
   * 採点していないカード」の集合として扱い、初回採点のときだけ更新する（再採点は不変）。
   * キュー・タイルの更新は recordReview の await より先に同期で行う（連打対策）。
   */
  const grade = useCallback(
    async (id: string, g: ReviewGrade): Promise<GradeOutcome> => {
      const card = byId.get(id)
      if (!card) return { sparkle: false, gold: false, deltaR: 0, cardId: id, known: false }

      // マーク/色（grade）と状態は初回でも再採点でも更新。ボタンは常に残る。
      // levelCounts はこのセッションでの体感が正（採点直後に丸へ即反映。recordReview の
      // 確定値を待たない＝連打しても丸がすぐ増える）。
      setTiles((ts) =>
        ts.map((t) => {
          if (t.card.id !== id) return t
          const counts = { ...(t.levelCounts ?? emptyLevelCounts()) }
          counts[gradeLevel(g)]++
          return { ...t, state: g === 'again' ? 'again' : 'done', grade: g, levelCounts: counts }
        }),
      )
      setReviewed((n) => n + 1)

      const firstThisSession = queueRef.current.includes(id)
      if (firstThisSession) {
        const rest = queueRef.current.filter((x) => x !== id)
        queueRef.current = g === 'again' ? [...rest, id] : rest // again は末尾へ戻して復習継続
        setPendingQueue(queueRef.current)
        if (g === 'again') setAgain((n) => n + 1)
      }

      const { wasNew, prevGrade, burnedNow, deltaR } = await recordReview(card, g)
      // きらきら演出：未習語を始めた／Fuzzy・Studying → I know の前進／卒業（金色）。
      return {
        sparkle: wasNew || isPromotionToKnown(prevGrade, g) || burnedNow,
        gold: burnedNow,
        deltaR,
        cardId: id,
        known: g === 'good' || g === 'easy',
      }
    },
    [byId],
  )

  /** 新しいセッションを組み直す。未習語の窓を1つ進めて毎回別の語を出す（未採点でも変わる）。 */
  const restart = useCallback(() => {
    newOffsetRef.current += NEW_PER_SESSION
    setNonce((n) => n + 1)
  }, [])

  /** デモ用：このコースの進捗を実際に消してから初期状態のセッションに戻す */
  const reset = useCallback(async () => {
    const courseId = cards[0]?.courseId
    if (courseId) await resetCourseProgress(courseId)
    newOffsetRef.current = 0
    setNonce((n) => n + 1)
  }, [cards])

  const finished = !loading && tiles.length > 0 && pendingQueue.length === 0
  const empty = !loading && tiles.length === 0
  const remaining = pendingQueue.length

  return { loading, tiles, queue: pendingQueue, grade, restart, reset, reviewed, again, finished, empty, remaining }
}
