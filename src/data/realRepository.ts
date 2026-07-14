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
  }
}
