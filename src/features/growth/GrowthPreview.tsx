import type { CourseId, DailyStat } from '../../types'
import { localDate } from '../../store/progress'
import { buildGrowth, shiftDate } from './growth'
import { GrowthView } from './GrowthView'

/**
 * 開発用プレビュー（#growth）。モックの日次ログを実パイプライン（buildGrowth）に通して
 * 成長曲線の見た目を確認する。既存の #design / #tones と同じ dev 専用ルート。
 * 本番からはハッシュ経由でしか到達せず無害。
 */
function mockSeries() {
  const today = localDate(new Date())
  const N = 45
  const courseId: CourseId = 'ja-0-3k'
  const gaps = new Set([4, 11, 12, 26, 33]) // たまに休んだ日（記録なし＝点なし）
  const stats: DailyStat[] = []
  let known = 58
  let cumNew = 0
  for (let i = N - 1; i >= 0; i--) {
    const day = N - 1 - i
    if (day % 7 === 6 || gaps.has(day)) continue
    const newStarted = 3 + (day % 4)
    cumNew += newStarted
    known += 2 + (day % 3)
    stats.push({
      courseId,
      date: shiftDate(today, -i),
      reviews: 12 + (day % 9),
      newStarted,
      promotions: 1 + (day % 2),
      dueReviews: 4 + (day % 3),
      dueAgain: day % 2,
      knownTotal: known,
    })
  }
  const baseline = 130 // 記録開始前から知っていた語（土台）
  return buildGrowth(stats, { introduced: baseline + cumNew, known, mastered: 18 }, today)
}

/** 早期利用の 2 点（小レンジ＝目盛り重複バグの再現条件）を検証するミニマル版 */
function minimalSeries() {
  const today = localDate(new Date())
  const courseId: CourseId = 'ja-0-3k'
  const stats: DailyStat[] = [
    { courseId, date: shiftDate(today, -1), reviews: 6, newStarted: 1, promotions: 0, dueReviews: 0, dueAgain: 0, knownTotal: 0 },
  ]
  return buildGrowth(stats, { introduced: 2, known: 1, mastered: 0 }, today)
}

export function GrowthPreview() {
  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(24px, 5vw, 56px) clamp(20px, 5vw, 64px)', display: 'grid', gap: 40 }}>
      <div>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '0 0 8px' }}>Rich (45 days)</p>
        <GrowthView series={mockSeries()} uiLanguage="en" />
      </div>
      <div>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '0 0 8px' }}>Minimal (2 days — early state)</p>
        <GrowthView series={minimalSeries()} uiLanguage="en" />
      </div>
    </div>
  )
}
