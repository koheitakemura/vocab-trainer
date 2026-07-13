import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type FSRS,
  type Grade,
} from 'ts-fsrs'

/**
 * 4段階評価（FSRS 標準の Again/Hard/Good/Easy）。UI 上は
 * Still learning / Sort of know / I know(flip後) / I know(即スキップ) に対応。
 * desired retention は既定 0.9。
 */
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

const RATING_BY_GRADE: Record<ReviewGrade, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}

const scheduler: FSRS = fsrs(generatorParameters({ request_retention: 0.9 }))

/** 新規カードの初期 FSRS 状態（due = 現在＝即出題可能） */
export function newCard(now: Date = new Date()): Card {
  return createEmptyCard(now)
}

/** 評価を適用して次の FSRS 状態を返す */
export function gradeCard(card: Card, grade: ReviewGrade, now: Date = new Date()): Card {
  const { card: next } = scheduler.next(card, now, RATING_BY_GRADE[grade])
  return next
}

/** due（復習期限が来ている）か */
export function isDue(card: Card, now: Date = new Date()): boolean {
  return card.due.getTime() <= now.getTime()
}

export { State }
export type { Card }
