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
 */
export function useStudyBoard(cards: VocabCard[]) {
  const [tiles, setTiles] = useState<BoardTile[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [cursor, setCursor] = useState(0)
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
      setTiles(session.map((c) => ({ card: c, state: 'pending' })))
      setOrder(session.map((c) => c.id))
      setCursor(0)
      setRevealed(false)
      setReviewed(0)
      setAgain(0)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [cards, nonce])

  const activeId = order[cursor] ?? null
  const active = activeId ? (tiles.find((t) => t.card.id === activeId)?.card ?? null) : null

  const reveal = useCallback(() => setRevealed(true), [])

  const grade = useCallback(
    async (g: ReviewGrade) => {
      const id = order[cursor]
      if (!id) return
      await recordReview(id, g)
      setReviewed((n) => n + 1)
      if (g === 'again') {
        setAgain((n) => n + 1)
        setOrder((o) => [...o, id]) // 末尾で再挑戦
        setTiles((ts) => ts.map((t) => (t.card.id === id ? { ...t, state: 'again' } : t)))
      } else {
        setTiles((ts) => ts.map((t) => (t.card.id === id ? { ...t, state: 'done' } : t)))
      }
      setRevealed(false)
      setCursor((c) => c + 1)
    },
    [order, cursor],
  )

  /** クリックで先の pending タイルへ移動（既定は自動進行だが手動選択も許可） */
  const focusTile = useCallback(
    (id: string) => {
      const idx = order.indexOf(id, cursor)
      if (idx >= 0) {
        setCursor(idx)
        setRevealed(false)
      }
    },
    [order, cursor],
  )

  const restart = useCallback(() => setNonce((n) => n + 1), [])

  const finished = !loading && order.length > 0 && cursor >= order.length
  const empty = !loading && tiles.length === 0

  return { loading, tiles, activeId, active, revealed, reveal, grade, focusTile, restart, reviewed, again, finished, empty }
}
