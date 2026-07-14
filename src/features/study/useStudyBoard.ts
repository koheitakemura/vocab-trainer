import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VocabCard } from '../../types'
import { db } from '../../store/db'
import { recordReview, resetCourseProgress } from '../../store/progress'
import { isPromotionToKnown } from '../../srs/levels'
import type { ReviewGrade } from '../../srs/scheduler'

/** レール型は1セッションの新規語を絞る（完走率のため。PLAN §4.1） */
const NEW_PER_SESSION = 16

export type TileState = 'pending' | 'again' | 'done'
export interface BoardTile {
  card: VocabCard
  state: TileState
  /** 直近に押したボタンの評価（未採点は undefined）。カードの枠線・点の色・ラベル用。 */
  grade?: ReviewGrade
}

/** grade() の結果（演出とヘッダーのメーター追従の判定材料） */
export interface GradeOutcome {
  /** きらきら演出を出すか（初採点 or Fuzzy/Studying → I know の前進 or 卒業） */
  sparkle: boolean
  /** 金色スパークル（卒業＝Mastered 到達） */
  gold: boolean
  /** 推定語彙数（retrievability 合計）の増分 */
  deltaR: number
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
export function useStudyBoard(cards: VocabCard[]) {
  const [tiles, setTiles] = useState<BoardTile[]>([])
  const [pendingQueue, setPendingQueue] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewed, setReviewed] = useState(0)
  const [again, setAgain] = useState(0)
  const [nonce, setNonce] = useState(0)
  // pendingQueue の同期ミラー。grade() は await を挟むため、state のクロージャだけに頼ると
  // 連打（再レンダー前の2打目）で1打目のキュー除去が巻き戻る＝セッションが完了不能になる。
  const queueRef = useRef<string[]>([])

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      const courseId = cards[0]?.courseId
      const rows = courseId ? await db.progress.where('courseId').equals(courseId).toArray() : []
      const progressById = new Map(rows.map((r) => [r.cardId, r]))
      const now = Date.now()
      const sessionTiles: BoardTile[] = []
      let newCount = 0
      for (const card of cards) {
        const r = progressById.get(card.id)
        if (!r || r.status === 'new') {
          // 本当の未習語だけ "New" 表示（grade 未設定）＝初採点でスパークルが発火する。
          if (newCount < NEW_PER_SESSION) {
            sessionTiles.push({ card, state: 'pending' })
            newCount++
          }
        } else if (r.status !== 'burned' && r.status !== 'suspended' && r.fsrs.due.getTime() <= now) {
          // 復習（既習・due）カードは "New" ではなく直近の採点（lastGrade）を初期表示する。
          // これで「全部 New に見えるのに一部しかスパークルしない」不整合が解消される。
          sessionTiles.push({ card, state: 'pending', grade: r.lastGrade })
        }
      }
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
  }, [cards, nonce])

  /**
   * id を明示指定して採点する。どのカードも採点後にボタンが残り、いつでも採点しなおせる。
   * 色・マークは初回でも再採点でも毎回更新する。完了判定用のキューは「まだ一度も
   * 採点していないカード」の集合として扱い、初回採点のときだけ更新する（再採点は不変）。
   * キュー・タイルの更新は recordReview の await より先に同期で行う（連打対策）。
   */
  const grade = useCallback(
    async (id: string, g: ReviewGrade): Promise<GradeOutcome> => {
      const card = byId.get(id)
      if (!card) return { sparkle: false, gold: false, deltaR: 0 }

      // マーク/色（grade）と状態は初回でも再採点でも更新。ボタンは常に残る。
      setTiles((ts) => ts.map((t) => (t.card.id === id ? { ...t, state: g === 'again' ? 'again' : 'done', grade: g } : t)))
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
      return { sparkle: wasNew || isPromotionToKnown(prevGrade, g) || burnedNow, gold: burnedNow, deltaR }
    },
    [byId],
  )

  const restart = useCallback(() => setNonce((n) => n + 1), [])

  /** デモ用：このコースの進捗を実際に消してから新しいセッションを組み直す */
  const reset = useCallback(async () => {
    const courseId = cards[0]?.courseId
    if (courseId) await resetCourseProgress(courseId)
    setNonce((n) => n + 1)
  }, [cards])

  const finished = !loading && tiles.length > 0 && pendingQueue.length === 0
  const empty = !loading && tiles.length === 0
  const remaining = pendingQueue.length

  return { loading, tiles, queue: pendingQueue, grade, restart, reset, reviewed, again, finished, empty, remaining }
}
