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

/**
 * Fuzzy/Studying から I know への「前進」か。
 * スパークル演出（useStudyBoard）と日次ログの promotions（recordReview）が同じ定義を共有する。
 */
export function isPromotionToKnown(prev: ReviewGrade | undefined, next: ReviewGrade): boolean {
  return prev !== undefined && gradeLevel(prev) !== 'known' && gradeLevel(next) === 'known'
}

/**
 * この progress 行を「I know（知っている語）」として数えるか。
 * ヘッダーの内訳（byGrade の good+easy ＋ burned）と JLPT リング・バッジが同じ定義を共有する
 * ＝ラチェット式バッジ（一度獲得したら消えない）が別定義で誤発行されるのを防ぐ。
 */
export function isKnownRow(row: { status: string; lastGrade?: ReviewGrade }): boolean {
  if (row.status === 'burned') return true
  return row.lastGrade !== undefined && gradeLevel(row.lastGrade) === 'known'
}

/** レベル別の押下回数のゼロ値（カードの丸表示用）。 */
export function emptyLevelCounts(): Record<GradeLevel, number> {
  return { known: 0, fuzzy: 0, learning: 0 }
}

/**
 * カードの丸表示用のレベル別回数。levelCounts を持つ行はそのまま返す。
 * 機能追加前の行（levelCounts が無い）は、全履歴を直近の評価（lastGrade）とみなして
 * reviewedCount を1バケットに寄せる一度きりの近似（内訳の記録が無いので厳密には出せない）。
 */
export function approxLevelCounts(row: {
  reviewedCount: number
  lastGrade?: ReviewGrade
  levelCounts?: Record<GradeLevel, number>
}): Record<GradeLevel, number> {
  if (row.levelCounts) return row.levelCounts
  const counts = emptyLevelCounts()
  if (row.lastGrade && row.reviewedCount > 0) counts[gradeLevel(row.lastGrade)] = row.reviewedCount
  return counts
}
