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
}

/**
 * Study Grid（案①）用のセッション。
 * due の学習中 + 新規 N 語を「ボード」として一括表示し、1枚ずつ active を進める。
 * Good=done（緑）／Again=末尾に再投入（琥珀）。進捗は Dexie に永続化。
 *
 * activeId は pendingQueue（未回答カードの ID 一覧）から明示的に選ぶ方式。
 * 「order 配列 + 前方検索のみのカーソル」方式だと、一度でも先のカードへジャンプした後は
 * それより手前の未回答タイルを二度とクリックできなくなるバグがあったため、この設計にした。
 */
export function useStudyBoard(cards: VocabCard[]) {
  const [tiles, setTiles] = useState<BoardTile[]>([])
  const [pendingQueue, setPendingQueue] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
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
      const ids = session.map((c) => c.id)
      setTiles(session.map((c) => ({ card: c, state: 'pending' })))
      setPendingQueue(ids)
      setActiveId(ids[0] ?? null)
      setRevealed(false)
      setReviewed(0)
      setAgain(0)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [cards, nonce])

  const active = activeId ? (tiles.find((t) => t.card.id === activeId)?.card ?? null) : null

  const reveal = useCallback(() => setRevealed(true), [])

  const grade = useCallback(
    async (g: ReviewGrade) => {
      const id = activeId
      if (!id) return
      await recordReview(id, g)
      setReviewed((n) => n + 1)

      const rest = pendingQueue.filter((x) => x !== id)
      const nextQueue = g === 'again' ? [...rest, id] : rest
      if (g === 'again') {
        setAgain((n) => n + 1)
        setTiles((ts) => ts.map((t) => (t.card.id === id ? { ...t, state: 'again' } : t)))
      } else {
        setTiles((ts) => ts.map((t) => (t.card.id === id ? { ...t, state: 'done' } : t)))
      }
      setPendingQueue(nextQueue)
      setActiveId(nextQueue[0] ?? null)
      setRevealed(false)
    },
    [activeId, pendingQueue],
  )

  /** タップで任意の未回答タイルへ移動（キューの位置に関係なく常に動く） */
  const focusTile = useCallback(
    (id: string) => {
      if (!pendingQueue.includes(id)) return
      setActiveId(id)
      setRevealed(false)
    },
    [pendingQueue],
  )

  const restart = useCallback(() => setNonce((n) => n + 1), [])

  const finished = !loading && tiles.length > 0 && pendingQueue.length === 0
  const empty = !loading && tiles.length === 0
  const remaining = pendingQueue.length

  return { loading, tiles, activeId, active, revealed, reveal, grade, focusTile, restart, reviewed, again, finished, empty, remaining }
}
