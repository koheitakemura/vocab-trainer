import type { GrowthSeries } from './growth'
import { GrowthChart } from './GrowthChart'
import { fmtNum } from '../../text/format'

/**
 * 成長タブの見た目（純粋・presentational）。見出し数字＋凡例＋成長曲線。
 * データが少ないうち（1点以下）は曲線を描かず「ここから伸びる」導入状態を出す
 * （記録は使うほど貯まる＝空グラフで寂しく見せない）。
 */
export function GrowthView({ series }: { series: GrowthSeries }) {
  const { points, started, known, mastered, activeDays, currentStreak, longestStreak } = series
  const hasCurve = points.length >= 2
  const neverStudied = started === 0 && known === 0

  return (
    <div className="growth-panel">
      {/* 見出し数字：まず「どれだけ育ったか」を数で（コツコツ感＝連続日数も併記） */}
      <div className="growth-stats">
        <div className="growth-stat">
          <span className="growth-stat-num growth-stat-num--started">{fmtNum(started)}</span>
          <span className="growth-stat-label">Words started</span>
        </div>
        <div className="growth-stat">
          <span className="growth-stat-num growth-stat-num--known">{fmtNum(known)}</span>
          <span className="growth-stat-label">Words known</span>
        </div>
        {mastered > 0 && (
          <div className="growth-stat">
            <span className="growth-stat-num growth-stat-num--mastered">{fmtNum(mastered)}</span>
            <span className="growth-stat-label">Mastered</span>
          </div>
        )}
        <div className="growth-stat">
          <span className="growth-stat-num">{currentStreak > 0 ? `🔥 ${currentStreak}` : '0'}</span>
          <span className="growth-stat-label">Day streak</span>
        </div>
        <div className="growth-stat">
          <span className="growth-stat-num">{activeDays}</span>
          <span className="growth-stat-label">Days studied</span>
        </div>
      </div>

      {hasCurve ? (
        <>
          <div className="growth-legend">
            <span className="growth-legend-item">
              <span className="growth-legend-swatch growth-legend-swatch--started" /> Started
            </span>
            <span className="growth-legend-item">
              <span className="growth-legend-swatch growth-legend-swatch--known" /> Known
            </span>
            {longestStreak > 1 && <span className="growth-legend-best">Best streak · {longestStreak} days</span>}
          </div>
          <GrowthChart points={points} />
          <p className="growth-caption">
            The green area is what you know; the gap above it is what you’re still learning. Keep showing up and watch
            it climb.
          </p>
        </>
      ) : (
        <div className="growth-empty">
          <div className="growth-empty-emoji">🌱</div>
          {neverStudied ? (
            <>
              <p className="growth-empty-title">Your growth curve starts here</p>
              <p className="growth-empty-sub">Study a few words and come back — this page fills in a little more every day.</p>
            </>
          ) : (
            <>
              <p className="growth-empty-title">You’re on your way</p>
              <p className="growth-empty-sub">
                Come back after another day of studying to watch your curve start to climb. Every day you show up adds a point.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
