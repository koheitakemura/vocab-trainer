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
      const sessionTiles: BoardTile[] = []
      let newCount = 0
      for (const r of rows) {
        if (!r) continue
        const card = byId.get(r.cardId)
        if (!card) continue
        if (r.status === 'new') {
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
      setPendingQueue(sessionTiles.map((t) => t.card.id))
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
   * 色・マークは初回でも再採点でも毎回更新する。完了判定用の pendingQueue は「まだ一度も
   * 採点していないカード」の集合として扱い、初回採点のときだけ更新する（再採点は不変）。
   * 戻り値は「この採点が初採点だったか」（status が 'new' から離れた瞬間かどうか）＝きらきら演出用。
   */
  const grade = useCallback(
    async (id: string, g: ReviewGrade): Promise<boolean> => {
      const { wasNew } = await recordReview(id, g)
      setReviewed((n) => n + 1)

      // マーク/色（grade）と状態は初回でも再採点でも更新。ボタンは常に残る。
      setTiles((ts) => ts.map((t) => (t.card.id === id ? { ...t, state: g === 'again' ? 'again' : 'done', grade: g } : t)))

      // キューはこのセッションでまだ一度も採点していないカードだけを保持する。
      const firstThisSession = pendingQueue.includes(id)
      if (firstThisSession) {
        const rest = pendingQueue.filter((x) => x !== id)
        setPendingQueue(g === 'again' ? [...rest, id] : rest) // again は末尾へ戻して復習継続
        if (g === 'again') setAgain((n) => n + 1)
      }
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
