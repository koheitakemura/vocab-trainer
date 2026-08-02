import { getRomaji } from './romaji'

const norm = (s: string) => s.toLowerCase().trim()

/**
 * 検索スコア（小さいほど上位）。見出し語の完全一致・前方一致を、読み・意味の部分一致より
 * 常に上に出す。一致しなければ null。gloss は無くてもよい——静的プールのインデックス
 * （見出し語＋読みのみ、サイズを絞るため gloss を持たない）にも同じロジックで使うため。
 * WordSearch（コース本体）と extraPool（プール検索）の両方が使う共通実装。
 */
export function wordMatchScore(
  headword: string,
  reading: string | undefined,
  gloss: string | undefined,
  query: string,
): number | null {
  const q = norm(query)
  if (!q) return null
  const h = norm(headword)
  const r = norm(reading ?? '')
  const romaji = norm(getRomaji(reading) ?? '')
  if (h === q) return 0
  if (h.startsWith(q)) return 1
  if (r === q || romaji === q) return 2
  if (r.startsWith(q) || romaji.startsWith(q)) return 3
  if (h.includes(q)) return 4
  if (r.includes(q) || romaji.includes(q)) return 5
  if (gloss && norm(gloss).includes(q)) return 6
  return null
}
