import type { ReviewGrade } from '../../srs/scheduler'
import { gradeLevel, LEVEL_ORDER, type GradeLevel } from '../../srs/levels'
import { useStrings, type UiLanguage } from '../../text/i18n'

/** 丸で見せる押下回数の上限（超えた分は "+N" にまとめる。カード右上の限られた幅に収めるため）。 */
const MAX_DOTS = 6

/**
 * カード右上のマーク：これまでの押下回数分の丸（レベル別に色分け）＋直近の評価ラベル。
 * 丸→ラベルの順（Kohei 指定・例:「●●● I know」）。グリッドのタイルとフォーカスシートで共有する。
 */
export function TileMark({
  grade,
  levelCounts,
  uiLanguage,
}: {
  grade?: ReviewGrade
  levelCounts?: Record<GradeLevel, number>
  uiLanguage: UiLanguage
}) {
  const t = useStrings(uiLanguage)
  const level = grade ? gradeLevel(grade) : null
  const markKind = level ?? 'new'
  const markLabel = level ? (level === 'known' ? t.gradeKnown : level === 'fuzzy' ? t.gradeFuzzy : t.gradeStudying) : t.statusNew

  const dots: { level: GradeLevel; key: string }[] = []
  for (const lv of LEVEL_ORDER) {
    const n = levelCounts?.[lv] ?? 0
    for (let i = 0; i < n; i++) dots.push({ level: lv, key: `${lv}-${i}` })
  }
  const shown = dots.slice(0, MAX_DOTS)
  const overflow = dots.length - shown.length

  return (
    <span className={`tile-mark tile-mark--${markKind}`}>
      {shown.length > 0 && (
        <span className="tile-mark-dots">
          {shown.map((d) => (
            <span key={d.key} className={`tile-mark-dot tile-mark-dot--${d.level}`} />
          ))}
          {overflow > 0 && <span className="tile-mark-overflow">+{overflow}</span>}
        </span>
      )}
      <span className="tile-mark-label">{markLabel}</span>
    </span>
  )
}
