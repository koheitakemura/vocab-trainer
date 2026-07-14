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

/**
 * いま思い出せる確率（retrievability 0..1）。未学習カードは 0。
 * 推定語彙数メーター＝「全カードの retrievability 合計」＝押しただけで増える水増しでない、
 * FSRS の記憶モデルに基づく「本当に頭に入っている語数」の期待値。
 */
export function retrievabilityOf(card: Card, now: Date = new Date()): number {
  if (card.state === State.New) return 0
  const r = scheduler.get_retrievability(card, now, false)
  return Number.isFinite(r) ? r : 0
}

/** これを超えた known カードは「卒業（Mastered）」＝レビューキューから恒久除外（PLAN §3.3 Burned） */
export const BURN_STABILITY_DAYS = 120

export { State }
export type { Card }
