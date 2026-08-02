import { describe, expect, it } from 'vitest'
import { emptySummary, isExtraCardId, summarize } from './db'
import type { WordProgress } from '../types'
import type { Card as FsrsCard } from 'ts-fsrs'

// 実際の FSRS 状態は使わないので最小限のダミーで足りる（summarize は fsrs の中身を読まない）
const DUMMY_FSRS = {} as FsrsCard

function progressRow(cardId: string, overrides: Partial<WordProgress> = {}): WordProgress {
  return {
    cardId,
    courseId: 'en-10-30k',
    status: 'known',
    fsrs: DUMMY_FSRS,
    reviewedCount: 1,
    lastGrade: 'good',
    ...overrides,
  }
}

describe('isExtraCardId', () => {
  it('検索して追加した語のID（-x + 8桁16進）だけ true', () => {
    expect(isExtraCardId('en-10-30k-x1e95d069')).toBe(true)
    expect(isExtraCardId('en-10-30k-x7dcd6ab6')).toBe(true)
  })

  it('パイプラインの連番採番（数字サフィックス）は false', () => {
    expect(isExtraCardId('en-10-30k-00042')).toBe(false)
    expect(isExtraCardId('ja-kanji-advanced-1974')).toBe(false)
  })

  it('8桁に満たない・16進以外を含む場合は false（誤検出しない）', () => {
    expect(isExtraCardId('en-10-30k-xabc')).toBe(false)
    expect(isExtraCardId('en-10-30k-xzzzzzzzz')).toBe(false)
  })
})

describe('summarize — 検索して追加した語をコース別サマリから除外する', () => {
  it('通常の語だけを introduced/byGrade/burned に数える', () => {
    const rows = [
      progressRow('en-10-30k-00001', { lastGrade: 'good' }),
      progressRow('en-10-30k-00002', { status: 'burned' }),
      // 追加語（-x…）は同じコースIDでも集計から外れる
      progressRow('en-10-30k-x1e95d069', { lastGrade: 'good' }),
      progressRow('en-10-30k-x7dcd6ab6', { status: 'burned' }),
    ]
    const [summary] = summarize(rows)
    expect(summary.courseId).toBe('en-10-30k')
    // 追加語2件を含めると introduced は4になってしまうところ、2のままであることを確認
    expect(summary.introduced).toBe(2)
    expect(summary.byGrade.good).toBe(1)
    expect(summary.burned).toBe(1)
  })

  it('追加語しか無いコースはサマリ自体が作られない（ゼロ値のコースとして扱う）', () => {
    const rows = [progressRow('en-10-30k-xaaaaaaaa'), progressRow('en-10-30k-xbbbbbbbb', { status: 'burned' })]
    expect(summarize(rows)).toEqual([])
  })

  it('status=new の行は従来どおり無視する（追加語フィルタと独立に効く）', () => {
    const rows = [progressRow('en-10-30k-00003', { status: 'new', lastGrade: undefined })]
    expect(summarize(rows)).toEqual([])
  })
})

describe('emptySummary', () => {
  it('ゼロ値を返す', () => {
    expect(emptySummary('en-10-30k')).toEqual({
      courseId: 'en-10-30k',
      introduced: 0,
      byGrade: { good: 0, easy: 0, hard: 0, again: 0 },
      burned: 0,
    })
  })
})
