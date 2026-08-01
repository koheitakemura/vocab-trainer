import { safeGet, safeSet } from '../../store/safeStorage'

/**
 * 1セッションで盤面に出す新規語の枚数（＝画面に並ぶカードの数）。
 *
 * ThemeToggle / 採点音と同じく localStorage に自己完結で永続化する（端末ごとの好み。
 * サーバーにも送らない）。値を変えたら 'vt:boardsize' イベントを飛ばし、
 * useStudyBoard が盤面を組み直す——ページを再読み込みしなくても即反映させるため。
 */

const STORAGE_KEY = 'vt:boardSize'
const CHANGE_EVENT = 'vt:boardsize'

/** 選べる枚数。4の倍数にしているのは、広い画面で4列に並んだとき最終行が欠けないため */
export const BOARD_SIZES = [8, 12, 16, 24, 32] as const
export type BoardSize = (typeof BOARD_SIZES)[number]

/** 既定は 16（この設定を入れる前からの挙動。PLAN §4.1 の「完走率のため絞る」枚数） */
export const DEFAULT_BOARD_SIZE: BoardSize = 16

export function getBoardSize(): BoardSize {
  const saved = Number(safeGet(STORAGE_KEY))
  return (BOARD_SIZES as readonly number[]).includes(saved) ? (saved as BoardSize) : DEFAULT_BOARD_SIZE
}

export function setBoardSize(size: BoardSize): void {
  safeSet(STORAGE_KEY, String(size))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** 枚数が変わったら呼ばれる。戻り値で購読解除する */
export function onBoardSizeChange(handler: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, handler)
  return () => window.removeEventListener(CHANGE_EVENT, handler)
}
