import { useCallback, useEffect, useState } from 'react'
import type { VocabCard } from '../../types'
import { db } from '../../store/db'
import { getOrCreateProgress, recordReview } from '../../store/progress'
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

/**
 * Study Grid（案①）用のセッション。
 * due の学習中 + 新規 N 語を「ボード」として一括表示する。
 * どのタイルをめくる/採点するかは各タイル側（ホバー・クリック）が自律的に決め、
 * ボード側は「自動で次のカードへ進める」ような遷移は行わない（Kohei の要望どおり）。
 */
export function useStudyBoard(cards: VocabCard[]) {
  const [tiles, setTiles] = useState<BoardTile[]>([])
  const [pendingQueue, setPendingQueue] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewed, setReviewed] = useState(0)
  const [again, setAgain] = useState(0)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      await Promise.all(cards.map((c) => getOrCreateProgress(c)))
      const rows = await db.progress.bulkGet(cards.map((c) => c.id))
      const byId = new Map(cards.map((c) => [c.id, c]))
      const now = Date.now()
      const session: VocabCard[] = []
      let newCount = 0
      for (const r of rows) {
        if (!r) continue
        const card = byId.get(r.cardId)
        if (!card) continue
        if (r.status === 'new') {
          if (newCount < NEW_PER_SESSION) {
            session.push(card)
            newCount++
          }
        } else if (r.status !== 'burned' && r.status !== 'suspended' && r.fsrs.due.getTime() <= now) {
          session.push(card)
        }
      }
      if (!active) return
      setTiles(session.map((c) => ({ card: c, state: 'pending' })))
      setPendingQueue(session.map((c) => c.id))
      setReviewed(0)
      setAgain(0)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [cards, nonce])

  /**
   * id を明示指定して採点する。採点後に他のタイルへ自動で移る、といったことはしない。
   * 戻り値は「この採点が初採点だったか」。status は 'new' から二度と戻らないため、
   * これだけで一度きりのイベント発火（開始アニメーション等）を判定できる。
   */
  const grade = useCallback(
    async (id: string, g: ReviewGrade): Promise<boolean> => {
      if (!pendingQueue.includes(id)) return false
      const { wasNew } = await recordReview(id, g)
      setReviewed((n) => n + 1)

      const rest = pendingQueue.filter((x) => x !== id)
      const nextQueue = g === 'again' ? [...rest, id] : rest
      if (g === 'again') {
        setAgain((n) => n + 1)
        setTiles((ts) => ts.map((t) => (t.card.id === id ? { ...t, state: 'again', grade: g } : t)))
      } else {
        setTiles((ts) => ts.map((t) => (t.card.id === id ? { ...t, state: 'done', grade: g } : t)))
      }
      setPendingQueue(nextQueue)
      return wasNew
    },
    [pendingQueue],
  )

  const restart = useCallback(() => setNonce((n) => n + 1), [])

  const finished = !loading && tiles.length > 0 && pendingQueue.length === 0
  const empty = !loading && tiles.length === 0
  const remaining = pendingQueue.length

  return { loading, tiles, grade, restart, reviewed, again, finished, empty, remaining }
}
