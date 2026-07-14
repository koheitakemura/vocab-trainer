import type { CourseId } from '../types'

/**
 * コーチが話す「既習語だけで組んだ日本語文」。coach-sentences.json（語彙データと分離した
 * overlay・precache 対象）から読み込む。words の全 id を覚えている文だけが画面に出る
 * ＝学習が進むほどコーチの話せる日本語が増える。
 */
export interface CoachSentence {
  jp: string
  en: string
  /** この文が使う内容語の cardId（全部 known になると解禁） */
  words: string[]
  tag:
    | 'morning'
    | 'afternoon'
    | 'evening'
    | 'night'
    | 'praise'
    | 'bigday'
    | 'milestone'
    | 'comeback'
    | 'encourage'
    | 'rest'
    | 'any'
}

const cache = new Map<CourseId, Promise<CoachSentence[]>>()

export function getCoachSentences(courseId: CourseId): Promise<CoachSentence[]> {
  let p = cache.get(courseId)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/courses/${courseId}/coach-sentences.json`)
      .then((r) => (r.ok ? (r.json() as Promise<CoachSentence[]>) : []))
      .catch(() => [] as CoachSentence[]) // 初回訪問オフライン等。2回目以降は precache が効く
    cache.set(courseId, p)
  }
  return p
}
