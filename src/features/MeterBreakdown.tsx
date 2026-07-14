import type { ReviewGrade } from '../srs/scheduler'
import { LEVEL_ORDER, LEVEL_LABEL, gradeLevel, type GradeLevel } from '../srs/levels'

const ALL_GRADES: ReviewGrade[] = ['good', 'easy', 'hard', 'again']

/**
 * Words Started の内訳（直近の採点ごとの語数）を、Mastered（卒業・金）＋3段階
 * （I know / Fuzzy / Studying）のセグメントバー＋ラベル付き凡例で表示する。
 * Mastered は1語でも出たときだけ凡例に載せる（それまで凡例を汚さない）。
 */
export function MeterBreakdown({ counts, burned = 0 }: { counts: Record<ReviewGrade, number>; burned?: number }) {
  const byLevel: Record<GradeLevel, number> = { known: 0, fuzzy: 0, learning: 0 }
  for (const g of ALL_GRADES) byLevel[gradeLevel(g)] += counts[g]

  const total = LEVEL_ORDER.reduce((sum, l) => sum + byLevel[l], 0) + burned
  if (total === 0) return null

  return (
    <div className="meter-breakdown">
      <div className="meter-segbar">
        {burned > 0 && (
          <span
            className="meter-seg meter-seg--mastered"
            style={{ width: `${(burned / total) * 100}%` }}
            title={`Mastered: ${burned}`}
          />
        )}
        {LEVEL_ORDER.map((l) =>
          byLevel[l] > 0 ? (
            <span
              key={l}
              className={`meter-seg meter-seg--${l}`}
              style={{ width: `${(byLevel[l] / total) * 100}%` }}
              title={`${LEVEL_LABEL[l]}: ${byLevel[l]}`}
            />
          ) : null,
        )}
      </div>
      <div className="meter-legend">
        {burned > 0 && (
          <span className="meter-legend-item">
            <span className="meter-dot meter-dot--mastered" />
            <span className="meter-legend-label">Mastered</span>
            <span className="meter-legend-count">{burned}</span>
          </span>
        )}
        {LEVEL_ORDER.map((l) => (
          <span key={l} className="meter-legend-item">
            <span className={`meter-dot meter-dot--${l}`} />
            <span className="meter-legend-label">{LEVEL_LABEL[l]}</span>
            <span className="meter-legend-count">{byLevel[l]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
