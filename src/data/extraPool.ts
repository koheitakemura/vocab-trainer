import type { CourseId, VocabCard } from '../types'
import { wordMatchScore } from '../text/wordMatch'

/**
 * 静的プール（コース構築時に生成済みだが未出荷のカード在庫。docs/word-request-design.md §6）。
 * `public/data/courses/<courseId>/extra-pool/` にビルド時生成された index.json + shard-*.json を
 * 読む。プールを持たないコースは index.json が 404 になり、常に空扱いになる（壊れない）。
 */

export interface ExtraPoolIndexEntry {
  id: string
  headword: string
  reading?: string
}

const BASE = 'data/courses'
const MAX_POOL_RESULTS = 5

async function fetchJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`)
  if (!res.ok) return null
  return (await res.json()) as T
}

function shardKey(headword: string): string {
  const first = headword.slice(0, 1).toLowerCase()
  return first >= 'a' && first <= 'z' ? first : 'other'
}

// コース内で1回だけ読めばよい（起動中に何度も同じ静的ファイルを取りにいかない）。
const indexCache = new Map<string, Promise<ExtraPoolIndexEntry[] | null>>()
const shardCache = new Map<string, Promise<VocabCard[] | null>>()

function loadIndex(courseId: CourseId): Promise<ExtraPoolIndexEntry[] | null> {
  let p = indexCache.get(courseId)
  if (!p) {
    p = fetchJson<ExtraPoolIndexEntry[]>(`${BASE}/${courseId}/extra-pool/index.json`)
    indexCache.set(courseId, p)
  }
  return p
}

function loadShard(courseId: CourseId, letter: string): Promise<VocabCard[] | null> {
  const key = `${courseId}:${letter}`
  let p = shardCache.get(key)
  if (!p) {
    p = fetchJson<VocabCard[]>(`${BASE}/${courseId}/extra-pool/shard-${letter}.json`)
    shardCache.set(key, p)
  }
  return p
}

/** プールを検索する（見出し語インデックスだけを読む・軽量）。プールが無いコースは常に []。 */
export async function searchExtraPool(courseId: CourseId, query: string): Promise<ExtraPoolIndexEntry[]> {
  const index = await loadIndex(courseId)
  if (!index || !query.trim()) return []
  const scored: { entry: ExtraPoolIndexEntry; score: number }[] = []
  for (const entry of index) {
    const score = wordMatchScore(entry.headword, entry.reading, undefined, query)
    if (score !== null) scored.push({ entry, score })
  }
  scored.sort((a, b) => a.score - b.score || a.entry.headword.length - b.entry.headword.length)
  return scored.slice(0, MAX_POOL_RESULTS).map((s) => s.entry)
}

/** インデックスの1件から本体（VocabCard）を取り出す。見出し語の頭文字シャードだけ読む。 */
export async function loadExtraPoolCard(courseId: CourseId, entry: ExtraPoolIndexEntry): Promise<VocabCard | null> {
  const shard = await loadShard(courseId, shardKey(entry.headword))
  if (!shard) return null
  return shard.find((c) => c.id === entry.id) ?? null
}
