import type { ReviewGrade } from '../srs/scheduler'

/**
 * 3段階のレベル（3つの採点ボタンに対応）。
 * FSRS の good/easy はどちらも「Got it」ボタン＝覚えた扱いなので known にまとめる。
 * 内部のスケジューリングは4段階のまま（good と easy で復習間隔は変わる）で、表示だけ3段階にする。
 */
type Level = 'known' | 'fuzzy' | 'learning'
const LEVELS: Level[] = ['known', 'fuzzy', 'learning']
const LEVEL_LABEL: Record<Level, string> = { known: 'Got it', fuzzy: 'Fuzzy', learning: 'Studying' }

/** Words Started の内訳（直近の採点ごとの語数）を、3段階（Got it / Fuzzy / Studying）のセグメントバー＋凡例で表示する。 */
export function MeterBreakdown({ counts }: { counts: Record<ReviewGrade, number> }) {
  const byLevel: Record<Level, number> = {
    known: counts.good + counts.easy,
    fuzzy: counts.hard,
    learning: counts.again,
  }
  const total = LEVELS.reduce((sum, l) => sum + byLevel[l], 0)
  if (total === 0) return null

  return (
    <div className="meter-breakdown">
      <div className="meter-segbar">
        {LEVELS.map((l) =>
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
        {LEVELS.map((l) => (
          <span key={l} className="meter-legend-item">
            <span className={`meter-dot meter-dot--${l}`} />
            {byLevel[l]}
          </span>
        ))}
      </div>
    </div>
  )
}
