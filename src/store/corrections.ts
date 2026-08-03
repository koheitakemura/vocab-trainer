import { apiUrl } from './sync'
import type { CourseId, Example, VocabCard } from '../types'

/**
 * 管理者が確定させたカードの是正（docs/word-request-design.md の「カードの誤り報告」機能）。
 *
 * コース本体（public/data/courses/(courseId)/words-N.json）はパイプライン再ビルド無しには直せない
 * ——1件の誤字のために毎回ビルド＋デプロイを挟むのは重すぎるため、是正だけは D1 に置き、
 * 起動時にコースの cards へ**表示専用の上書き**として重ねる（categories.json の overlay と
 * 同じ考え方。実データは変わらない＝進捗の cardId には一切影響しない）。
 *
 * オフライン時・未デプロイ時は黙ってフェッチを諦める——是正が反映されないだけで、
 * 元の（まだ間違っているかもしれない）カードがそのまま出るだけの安全側の失敗。
 */

export interface Correction {
  cardId: string
  headword: string
  reading: string
  gloss: string
  pos: string
  examples: Example[]
}

export async function fetchCorrections(courseId: CourseId): Promise<Correction[]> {
  try {
    const res = await fetch(apiUrl(`api/corrections?courseId=${encodeURIComponent(courseId)}`), {
      credentials: 'same-origin',
    })
    if (!res.ok) return []
    const data = (await res.json()) as { corrections?: Correction[] }
    return Array.isArray(data.corrections) ? data.corrections : []
  } catch {
    return []
  }
}

/** cards へ是正を重ねる（フルセット上書き。部分パッチにしない理由は worker/reports.ts 冒頭参照） */
export function applyCorrections(cards: VocabCard[], corrections: Correction[]): VocabCard[] {
  if (corrections.length === 0) return cards
  const byId = new Map(corrections.map((c) => [c.cardId, c]))
  return cards.map((card) => {
    const fix = byId.get(card.id)
    if (!fix) return card
    return {
      ...card,
      headword: fix.headword,
      reading: fix.reading || undefined,
      gloss: fix.gloss,
      pos: fix.pos,
      examples: fix.examples,
    }
  })
}
