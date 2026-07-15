import type { GrowthSeries } from './growth'
import { GrowthChart } from './GrowthChart'
import { fmtNum } from '../../text/format'
import { useStrings, type UiLanguage } from '../../text/i18n'

/**
 * 成長タブの見た目（純粋・presentational）。見出し数字＋凡例＋成長曲線。
 * データが少ないうち（1点以下）は曲線を描かず「ここから伸びる」導入状態を出す
 * （記録は使うほど貯まる＝空グラフで寂しく見せない）。
 */
export function GrowthView({ series, uiLanguage }: { series: GrowthSeries; uiLanguage: UiLanguage }) {
  const t = useStrings(uiLanguage)
  const { points, started, known, mastered, activeDays, currentStreak, longestStreak } = series
  const hasCurve = points.length >= 2
  const neverStudied = started === 0 && known === 0

  return (
    <div className="growth-panel">
      {/* 見出し数字：まず「どれだけ育ったか」を数で（コツコツ感＝連続日数も併記） */}
      <div className="growth-stats">
        <div className="growth-stat">
          <span className="growth-stat-num growth-stat-num--started">{fmtNum(started)}</span>
          <span className="growth-stat-label">{t.statsWordsStarted}</span>
        </div>
        <div className="growth-stat">
          <span className="growth-stat-num growth-stat-num--known">{fmtNum(known)}</span>
          <span className="growth-stat-label">{t.wordsKnown}</span>
        </div>
        {mastered > 0 && (
          <div className="growth-stat">
            <span className="growth-stat-num growth-stat-num--mastered">{fmtNum(mastered)}</span>
            <span className="growth-stat-label">{t.mastered}</span>
          </div>
        )}
        <div className="growth-stat">
          <span className="growth-stat-num">{currentStreak > 0 ? `🔥 ${currentStreak}` : '0'}</span>
          <span className="growth-stat-label">{t.dayStreak}</span>
        </div>
        <div className="growth-stat">
          <span className="growth-stat-num">{activeDays}</span>
          <span className="growth-stat-label">{t.daysStudied}</span>
        </div>
      </div>

      {hasCurve ? (
        <>
          <div className="growth-legend">
            <span className="growth-legend-item">
              <span className="growth-legend-swatch growth-legend-swatch--started" /> {t.growthLegendStarted}
            </span>
            <span className="growth-legend-item">
              <span className="growth-legend-swatch growth-legend-swatch--known" /> {t.growthLegendKnown}
            </span>
            {longestStreak > 1 && <span className="growth-legend-best">{t.bestStreak(longestStreak)}</span>}
          </div>
          <GrowthChart points={points} uiLanguage={uiLanguage} />
          <p className="growth-caption">{t.growthCaption}</p>
        </>
      ) : (
        <div className="growth-empty">
          <div className="growth-empty-emoji">🌱</div>
          {neverStudied ? (
            <>
              <p className="growth-empty-title">{t.growthEmptyStartTitle}</p>
              <p className="growth-empty-sub">{t.growthEmptyStartSub}</p>
            </>
          ) : (
            <>
              <p className="growth-empty-title">{t.growthEmptyOnWayTitle}</p>
              <p className="growth-empty-sub">{t.growthEmptyOnWaySub}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
