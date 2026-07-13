import type { ReviewGrade } from './scheduler'

/**
 * 表示用の3段階レベル（3つの採点ボタンに対応）。ヘッダーの内訳とカードの色・ラベルで共有する。
 * - known    : 「I know」（good / easy をまとめる）＝緑
 * - fuzzy    : 「Fuzzy」（hard）＝オレンジ
 * - learning : 「Studying」（again）＝赤
 */
export type GradeLevel = 'known' | 'fuzzy' | 'learning'

export const LEVEL_ORDER: GradeLevel[] = ['known', 'fuzzy', 'learning']

/** ボタン名に揃えたラベル。 */
export const LEVEL_LABEL: Record<GradeLevel, string> = {
  known: 'I know',
  fuzzy: 'Fuzzy',
  learning: 'Studying',
}

/** FSRS の4段階評価を表示用の3段階レベルへ落とす。 */
export function gradeLevel(g: ReviewGrade): GradeLevel {
  if (g === 'again') return 'learning'
  if (g === 'hard') return 'fuzzy'
  return 'known' // good / easy
}
