import { Fragment } from 'react'
import { coverageAt } from '../data/coverage'
import { useStrings, type UiLanguage } from '../text/i18n'

/**
 * 最寄りの次の節目（500語刻み）への常設カウントダウン。
 * 遠い3,075語ではなく「次の目盛りまであと N 語」を見せて目標勾配を刻み直す
 * （Kivetz 2006: ゴールに近いほど努力が加速。残り10%で強調色）。
 */
export function MilestoneChip({
  introduced,
  total,
  uiLanguage,
}: {
  introduced: number
  total: number
  uiLanguage: UiLanguage
}) {
  const t = useStrings(uiLanguage)
  if (introduced <= 0) return null
  if (introduced >= total) return <div className="milestone-chip done">{t.courseComplete(total)}</div>
  const next = Math.min(Math.ceil((introduced + 1) / 500) * 500, total)
  const remaining = next - introduced
  const near = remaining <= 50
  return (
    <div className={`milestone-chip${near ? ' near' : ''}`}>
      {t.nextMilestone(next, remaining, coverageAt(next)).map((p, i) =>
        p.bold ? <strong key={i}>{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>,
      )}
    </div>
  )
}
