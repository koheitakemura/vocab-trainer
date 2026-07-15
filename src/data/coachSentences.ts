import type { CourseId } from '../types'

/**
 * コーチが話す「既習語だけで組んだ学習言語の文」。coach-sentences.json（語彙データと分離した
 * overlay・precache 対象）から読み込む。words の全 id を覚えている文だけが画面に出る
 * ＝学習が進むほどコーチの話せる文が増える。フィールド名は言語ペア非依存（text=学習言語／
 * translation=グロス言語）＝コースごとの言語の組み合わせを型で決め打ちしない。
 */
export interface CoachSentence {
  /** 学習言語の文 */
  text: string
  /** 訳語（グロス言語）の文 */
  translation: string
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
