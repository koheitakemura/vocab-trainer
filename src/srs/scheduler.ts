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

/**
 * enable_short_term=false：分単位の学習ステップを使わず、どの評価も日単位の間隔にする。
 * このアプリは1日1〜2セッションのレール型で、同セッション内の再出題は Studying の
 * キュー戻しで扱う。ステップ有効だと「I know」でも約10分後に再出題されてしまうため無効化する。
 */
const scheduler: FSRS = fsrs(generatorParameters({ request_retention: 0.9, enable_short_term: false }))

/** 「I know」（good/easy）の最短復習間隔（日）。覚えた語を数日でしつこく出さない（Kohei 指定） */
const MIN_KNOWN_INTERVAL_DAYS = 7

/** 新規カードの初期 FSRS 状態（due = 現在＝即出題可能） */
export function newCard(now: Date = new Date()): Card {
  return createEmptyCard(now)
}

/**
 * 評価を適用して次の FSRS 状態を返す。
 * 「I know」（good/easy）は最短でも1週間後になるよう、FSRS の間隔がそれ未満なら押し下げる。
 * stability/difficulty は FSRS の計算どおり（＝以後の間隔は正常に伸び続ける）で、due だけを繰り下げる。
 */
export function gradeCard(card: Card, grade: ReviewGrade, now: Date = new Date()): Card {
  const { card: next } = scheduler.next(card, now, RATING_BY_GRADE[grade])
  if (grade === 'good' || grade === 'easy') {
    const floorMs = now.getTime() + MIN_KNOWN_INTERVAL_DAYS * 86_400_000
    if (next.due.getTime() < floorMs) {
      next.due = new Date(floorMs)
      next.scheduled_days = MIN_KNOWN_INTERVAL_DAYS
    }
  }
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
