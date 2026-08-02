import type { CourseId, VocabCard } from '../types'
import { apiUrl } from '../store/sync'

/**
 * 静的プールにも無い語を Worker 経由で AI 生成する（docs/word-request-design.md §7・§9・Phase 3）。
 * 検索の最終手段——ローカル一致・静的プールのどちらにもヒットしないときだけ呼ぶ。
 */

export type WordGenFailure = 'not-found' | 'rate-limited' | 'disabled' | 'offline'

export interface WordGenResult {
  ok: true
  card: VocabCard
  source: 'reused' | 'generated'
}

export interface WordGenError {
  ok: false
  reason: WordGenFailure
  message: string
}

/**
 * 失敗は例外を投げず {ok:false} で返す——検索ボックスの表示を壊さないため。
 * 生成対象の言語（学習言語・訳の言語）はクライアントからは送らない——Worker がコース自身の
 * meta.json から読む（唯一の正）。2026-08-02 security-reviewer 指摘：クライアント申告を信用すると
 * ① AI システムプロンプトへ直接混じる値になり正規表現だけでは injection を防ぎきれない
 * ②生成キャッシュ（extra_cards）は言語を鍵に含まないため、誤った言語で最初に生成された
 * カードがそのコースの全利用者に配信され続ける、の2つの実害があった。
 */
export async function generateCard(courseId: CourseId, headword: string): Promise<WordGenResult | WordGenError> {
  try {
    const res = await fetch(apiUrl('api/words/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, headword }),
      credentials: 'same-origin',
    })
    if (!res.ok) {
      const reason: WordGenFailure = res.status === 429 ? 'rate-limited' : res.status === 503 ? 'disabled' : 'not-found'
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      return { ok: false, reason, message: body?.error ?? '' }
    }
    const data = (await res.json()) as { card: VocabCard; source: 'reused' | 'generated' }
    return { ok: true, card: data.card, source: data.source }
  } catch {
    return { ok: false, reason: 'offline', message: '' }
  }
}
