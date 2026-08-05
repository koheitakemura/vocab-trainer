import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CourseType, VocabCard, WordProgress } from '../../types'
import { db } from '../../store/db'
import { localDate, recordReview, resetCourseProgress } from '../../store/progress'
import { approxLevelCounts, gradeLevel, isPromotionToKnown, type GradeLevel } from '../../srs/levels'
import { shouldClozePromote } from '../../srs/cloze'
import { newCard, type ReviewGrade } from '../../srs/scheduler'

import { getBoardSize, onBoardSizeChange } from './boardSize'

// 1セッションの新規語は絞る（完走率のため。PLAN §4.1）。
// 枚数はフッターの設定で変えられる（既定 16）＝ boardSize.ts

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
  // 盤面を組んだ時点（＝このページを開いた時点）の進捗行。カードごとの「丸」（levelCounts）と
  // FSRS スケジュールの両方の起点として使う。同じページを表示している間に何度採点しなおしても、
  // 丸は常にこの起点＋直近1回分に固定し、次回スケジュールもこの起点＋直近1回分だけで計算する
  // （毎回 DB の最新値を起点にすると、連打のたびに丸が増え・スケジュールも積み重なってしまうため）。
  const baselineProgressRef = useRef<Map<string, WordProgress>>(new Map())
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
      // 枚数は設定を毎回読み直す（変更時は下の effect が nonce を進めてここへ戻ってくる）
      const newPerSession = getBoardSize()
      for (let i = 0; i < Math.min(newPerSession, total); i++) {
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
      // progressById はこのコースの全進捗行（このページを開いた時点の値）＝そのまま起点として使える。
      baselineProgressRef.current = progressById
      setPendingQueue(queueRef.current)
      setReviewed(0)
      setAgain(0)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [cards, nonce, courseType])

  // 表示枚数の設定が変わったら盤面を組み直す（未採点のカードは入れ替わる）。
  // 再読み込みを挟まずに反映させたいので、localStorage の変更をイベントで受ける。
  useEffect(() => onBoardSizeChange(() => setNonce((n) => n + 1)), [])

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
      // levelCounts は baseline（このページを開いた時点の値）＋今回の1回だけ。
      // 毎回 DB の最新値を起点にすると、このページを表示している間の連打・押し直しのたびに
      // 丸が積み上がってしまう（採点直後に即反映させたい体感は baseline 起点でも変わらない）。
      // このコースで初めて触るカードは盤面構築時点では progress 行が無い（＝baseline 未登録）ので、
      // このページで最初に触った瞬間に新規カードの初期値を起点として一度だけ固定する
      // （固定しないと、2回目以降の押し直しが「直前の押下結果」を起点にしてしまい、
      // levelCounts と同じ理由で FSRS の次回スケジュールも積み重なってしまう）。
      let baseline = baselineProgressRef.current.get(id)
      if (!baseline) {
        baseline = { cardId: card.id, courseId: card.courseId, status: 'new', fsrs: newCard(), reviewedCount: 0 }
        baselineProgressRef.current.set(id, baseline)
      }
      const counts = { ...approxLevelCounts(baseline) }
      counts[gradeLevel(g)]++
      setTiles((ts) =>
        ts.map((t) => {
          if (t.card.id !== id) return t
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

      const { wasNew, prevGrade, burnedNow, deltaR } = await recordReview(card, g, counts, baseline)
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
    // 窓を進める幅は「今の表示枚数」ぶん。固定値だと、枚数を変えたときに
    // 語が飛ばされたり重複したりする（例: 32枚表示なのに16ずつ進めると半分が再登場）。
    newOffsetRef.current += getBoardSize()
    setNonce((n) => n + 1)
  }, [])

  /**
   * 盤面を今の DB の内容で組み直す（表示する語の窓は動かさない）。
   * 復元のように progress が丸ごと入れ替わったときに呼ぶ——盤面は「開いた時点の進捗」を
   * ref に固定して動く（baselineProgressRef）ので、これを呼ばないと復元後も古い丸・古い
   * スケジュール起点のまま採点され、画面上も「同期された形跡が無い」状態が続く。
   * restart と違って窓を進めないのは、復元は“別のセッションを始める”操作ではないため。
   */
  const reload = useCallback(() => setNonce((n) => n + 1), [])

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

  return { loading, tiles, queue: pendingQueue, grade, restart, reload, reset, reviewed, again, finished, empty, remaining }
}
