import type { Course, CourseId, VocabCard } from '../types'
import type { CourseRepository } from './courseRepository'

/**
 * 本物データの実装。/public/data/courses/<courseId>/ 配下の静的 JSON を fetch する。
 * - meta.json: Course 情報
 * - words-XXXX.json: 1k帯ごとの VocabCard[]（Phase 0/1 のパイプライン出力をそのまま配置）
 * データが未生成の帯は 404 として無視し、生成済みの帯だけ結合して返す（段階的にリリースできる）。
 */
const BASE = 'data/courses'

async function fetchJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`)
  if (!res.ok) return null
  return (await res.json()) as T
}

export const realRepository: CourseRepository = {
  async getCourse(id) {
    const meta = await fetchJson<Course>(`${BASE}/${id}/meta.json`)
    if (!meta) throw new Error(`real データ未生成のコース: ${id}`)
    return meta
  },
  async getCards(id) {
    const manifest = await fetchJson<{ bands: string[] }>(`${BASE}/${id}/manifest.json`)
    if (!manifest) return []
    const [chunks, categories] = await Promise.all([
      Promise.all(manifest.bands.map((b) => fetchJson<VocabCard[]>(`${BASE}/${id}/${b}`))),
      // カテゴリーは語彙データと分離した overlay（cardId → category）。無ければカテゴリー無しで動く。
      fetchJson<Record<string, string>>(`${BASE}/${id}/categories.json`),
    ])
    const cards = chunks.filter((c): c is VocabCard[] => c !== null).flat()
    if (categories) {
      for (const c of cards) {
        const cat = categories[c.id]
        if (cat && cat !== 'other') c.category = cat
      }
    }
    return cards
  },
  /**
   * プレビュー用の軽量版。manifest の先頭帯から順に fetch し、limit 件に達したら
   * それ以降の帯は取りに行かない（getCards のように全帯を読むと、未割当コースを
   * 覗いただけで数MB〜十数MBの帯域を消費してしまう＝vite.config.ts の方針に反する）。
   * カテゴリー overlay はプレビューでは使わないので取得しない。
   */
  async getCardsPreview(id, limit) {
    const manifest = await fetchJson<{ bands: string[] }>(`${BASE}/${id}/manifest.json`)
    if (!manifest) return []
    const cards: VocabCard[] = []
    for (const band of manifest.bands) {
      if (cards.length >= limit) break
      const chunk = await fetchJson<VocabCard[]>(`${BASE}/${id}/${band}`)
      if (chunk) cards.push(...chunk)
    }
    return cards.sort((a, b) => a.frequencyRank - b.frequencyRank).slice(0, limit)
  },
}

/** real にデータがあればそれを、無ければ mock にフォールバックする合成リポジトリ */
export function withRealFallback(real: CourseRepository, mock: CourseRepository): CourseRepository {
  return {
    async getCourse(id: CourseId) {
      try {
        return await real.getCourse(id)
      } catch {
        return mock.getCourse(id)
      }
    },
    async getCards(id: CourseId) {
      const cards = await real.getCards(id)
      return cards.length > 0 ? cards : mock.getCards(id)
    },
    async getCardsPreview(id: CourseId, limit: number) {
      const cards = await real.getCardsPreview(id, limit)
      return cards.length > 0 ? cards : mock.getCardsPreview(id, limit)
    },
  }
}
