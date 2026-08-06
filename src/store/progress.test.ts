import { describe, expect, it } from 'vitest'
import { mergeDailyStat, reviewedAtMs } from './progress'
import type { DailyStat, WordProgress } from '../types'
import type { Card as FsrsCard } from 'ts-fsrs'

function row(overrides: Partial<WordProgress> = {}): WordProgress {
  return {
    cardId: 'en-10-30k-00042',
    courseId: 'en-10-30k',
    status: 'known',
    fsrs: {} as FsrsCard,
    reviewedCount: 1,
    ...overrides,
  }
}

function stat(overrides: Partial<DailyStat> = {}): DailyStat {
  return {
    courseId: 'en-10-30k',
    date: '2026-08-05',
    reviews: 0,
    newStarted: 0,
    promotions: 0,
    dueReviews: 0,
    dueAgain: 0,
    knownTotal: 0,
    ...overrides,
  }
}

describe('reviewedAtMs — 統合でどちらの記録を採るかの判定軸', () => {
  it('lastReviewedAt を第一の基準にする', () => {
    const older = row({ lastReviewedAt: '2026-08-04T10:00:00.000Z' })
    const newer = row({ lastReviewedAt: '2026-08-05T10:00:00.000Z' })
    expect(reviewedAtMs(newer)).toBeGreaterThan(reviewedAtMs(older))
  })

  it('lastReviewedAt が無い行は FSRS の last_review で代用する', () => {
    const p = row({ fsrs: { last_review: new Date('2026-08-05T10:00:00.000Z') } as FsrsCard })
    expect(reviewedAtMs(p)).toBe(Date.parse('2026-08-05T10:00:00.000Z'))
  })

  it('どちらも無ければ 0（最も古い扱い）＝手元の記録が残る', () => {
    expect(reviewedAtMs(row())).toBe(0)
  })

  it('壊れた lastReviewedAt は 0 にフォールバックする（NaN で比較が壊れない）', () => {
    expect(reviewedAtMs(row({ lastReviewedAt: 'not-a-date' }))).toBe(0)
  })

  it('「学習中に戻した」最新の記録の方が新しい＝進み具合では比べない', () => {
    // 別端末で I know を押した後、この端末で Studying に押し直した——最後に押した方が事実
    const knownEarlier = row({ status: 'known', lastGrade: 'good', lastReviewedAt: '2026-08-05T09:00:00.000Z' })
    const studyingLater = row({ status: 'learning', lastGrade: 'again', lastReviewedAt: '2026-08-05T21:00:00.000Z' })
    expect(reviewedAtMs(studyingLater)).toBeGreaterThan(reviewedAtMs(knownEarlier))
  })
})

describe('mergeDailyStat — 同じ日の記録が両端末にあるとき', () => {
  it('項目ごとに大きい方を採る（合算しない＝共通の祖先を二重計上しない）', () => {
    const a = stat({ reviews: 30, newStarted: 10, promotions: 2, dueReviews: 5, dueAgain: 1, knownTotal: 84 })
    const b = stat({ reviews: 12, newStarted: 12, promotions: 1, dueReviews: 9, dueAgain: 0, knownTotal: 108 })
    expect(mergeDailyStat(a, b)).toEqual(
      stat({ reviews: 30, newStarted: 12, promotions: 2, dueReviews: 9, dueAgain: 1, knownTotal: 108 }),
    )
  })
})
