import { describe, expect, it } from 'vitest'
import { shrinkingCourses, snapshotRowCounts } from './snapshot'
import type { CourseId, WordProgress } from '../types'
import type { Card as FsrsCard } from 'ts-fsrs'

// 行数だけを数える関数なので FSRS の中身は使わない
const DUMMY_FSRS = {} as FsrsCard

function row(courseId: CourseId, status: WordProgress['status'] = 'known'): WordProgress {
  return { cardId: `${courseId}-${Math.random()}`, courseId, status, fsrs: DUMMY_FSRS, reviewedCount: 1 }
}

describe('snapshotRowCounts', () => {
  it('コース別に数える', () => {
    const counts = snapshotRowCounts([row('en-10-30k'), row('en-10-30k'), row('ja-kana')])
    expect(counts.get('en-10-30k')).toBe(2)
    expect(counts.get('ja-kana')).toBe(1)
  })

  it("status 'new' は数えない（importProgress が捨てる行と数え方を揃える）", () => {
    const counts = snapshotRowCounts([row('en-10-30k'), row('en-10-30k', 'new')])
    expect(counts.get('en-10-30k')).toBe(1)
  })
})

describe('shrinkingCourses — 復元でこの端末の記録が減るコース', () => {
  it('サーバーの方が少ないコースだけを返す', () => {
    const local = new Map([
      ['en-10-30k', 108],
      ['ja-kana', 30],
    ])
    const snapshot = new Map([
      ['en-10-30k', 84],
      ['ja-kana', 40],
    ])
    expect(shrinkingCourses(local, snapshot)).toEqual([{ courseId: 'en-10-30k', local: 108, snapshot: 84 }])
  })

  it('スナップショットに無いコースは 0 語として扱う（丸ごと消えるので必ず警告する）', () => {
    expect(shrinkingCourses(new Map([['tl-0-2k', 12]]), new Map())).toEqual([
      { courseId: 'tl-0-2k', local: 12, snapshot: 0 },
    ])
  })

  it('減り幅の大きい順に並べる', () => {
    const local = new Map([
      ['a', 20],
      ['b', 50],
    ])
    const snapshot = new Map([
      ['a', 5],
      ['b', 10],
    ])
    expect(shrinkingCourses(local, snapshot).map((s) => s.courseId)).toEqual(['b', 'a'])
  })

  it('同数・増える側は返さない（正常な復元で警告を出さない）', () => {
    const local = new Map([
      ['a', 10],
      ['b', 10],
    ])
    const snapshot = new Map([
      ['a', 10],
      ['b', 99],
    ])
    expect(shrinkingCourses(local, snapshot)).toEqual([])
  })
})
