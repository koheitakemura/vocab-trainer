import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type FSRS,
} from 'ts-fsrs'

/** MVP は Again/Good の2択（PLAN §3.1）。desired retention は既定 0.9。 */
export type ReviewGrade = 'again' | 'good'

const scheduler: FSRS = fsrs(generatorParameters({ request_retention: 0.9 }))

/** 新規カードの初期 FSRS 状態（due = 現在＝即出題可能） */
export function newCard(now: Date = new Date()): Card {
  return createEmptyCard(now)
}

/** 評価を適用して次の FSRS 状態を返す */
export function gradeCard(card: Card, grade: ReviewGrade, now: Date = new Date()): Card {
  const rating = grade === 'again' ? Rating.Again : Rating.Good
  const { card: next } = scheduler.next(card, now, rating)
  return next
}

/** due（復習期限が来ている）か */
export function isDue(card: Card, now: Date = new Date()): boolean {
  return card.due.getTime() <= now.getTime()
}

export { State }
export type { Card }
