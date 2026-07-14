import { coverageAt } from '../data/coverage'
import { fmtNum as fmt } from '../text/format'

/**
 * 最寄りの次の節目（500語刻み）への常設カウントダウン。
 * 遠い3,075語ではなく「次の目盛りまであと N 語」を見せて目標勾配を刻み直す
 * （Kivetz 2006: ゴールに近いほど努力が加速。残り10%で強調色）。
 */
export function MilestoneChip({ introduced, total }: { introduced: number; total: number }) {
  if (introduced <= 0) return null
  if (introduced >= total)
    return <div className="milestone-chip done">All {fmt(total)} words started — course complete 🎉</div>
  const next = Math.min(Math.ceil((introduced + 1) / 500) * 500, total)
  const remaining = next - introduced
  const near = remaining <= 50
  return (
    <div className={`milestone-chip${near ? ' near' : ''}`}>
      Next: <strong>{fmt(next)}</strong> · {remaining} to go · unlocks ~{coverageAt(next)}% of everyday conversation
    </div>
  )
}
