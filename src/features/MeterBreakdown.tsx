import type { ReviewGrade } from '../srs/scheduler'

const GRADE_ORDER: ReviewGrade[] = ['good', 'easy', 'hard', 'again']
const GRADE_LABEL: Record<ReviewGrade, string> = { good: 'Good', easy: 'Easy', hard: 'Hard', again: 'Again' }

/** Words Started の内訳（直近の採点ごとの語数）を、4色セグメントバー＋色ドットの凡例で表示する。 */
export function MeterBreakdown({ counts }: { counts: Record<ReviewGrade, number> }) {
  const total = GRADE_ORDER.reduce((sum, g) => sum + counts[g], 0)
  if (total === 0) return null

  return (
    <div className="meter-breakdown">
      <div className="meter-segbar">
        {GRADE_ORDER.map((g) =>
          counts[g] > 0 ? (
            <span
              key={g}
              className={`meter-seg meter-seg--${g}`}
              style={{ width: `${(counts[g] / total) * 100}%` }}
              title={`${GRADE_LABEL[g]}: ${counts[g]}`}
            />
          ) : null,
        )}
      </div>
      <div className="meter-legend">
        {GRADE_ORDER.map((g) => (
          <span key={g} className="meter-legend-item">
            <span className={`meter-dot meter-dot--${g}`} />
            {counts[g]}
          </span>
        ))}
      </div>
    </div>
  )
}
