import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { GrowthPoint } from './growth'
import { parseDate } from './growth'
import { fmtNum } from '../../text/format'

/**
 * 成長曲線チャート（inline SVG・描画専用の純粋コンポーネント）。
 * 外部ライブラリを足さない（このアプリは全描画を手書き）。色はアプリ既存トークンを流用：
 * Started=accent（青）／Known=good（緑）。ダーク/ライトは CSS 変数で自動追従。
 *
 * x 軸は「日付（実時間）」でマッピングする＝活動が無かった日は点を持たず、線が
 * その区間を素直につないで「じわじわ伸びる」曲線に見える（成長の体感を優先）。
 */

// 内部座標系（viewBox）。実表示は width:100% で拡縮する。
const VB_W = 680
const VB_H = 300
const PAD = { top: 20, right: 20, bottom: 34, left: 50 }
const PLOT_W = VB_W - PAD.left - PAD.right
const PLOT_H = VB_H - PAD.top - PAD.bottom
const Y_INTERVALS = 5 // 目盛りの区間数（＋1本がラベル線）
const MARKER_MAX = 24 // これ以下の点数のときだけ各点にマーカーを打つ

function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range || 1))
  const frac = range / 10 ** exp
  const nf = round
    ? frac < 1.5
      ? 1
      : frac < 3
        ? 2
        : frac < 7
          ? 5
          : 10
    : frac <= 1
      ? 1
      : frac <= 2
        ? 2
        : frac <= 5
          ? 5
          : 10
  return nf * 10 ** exp
}

/**
 * データ範囲に「きりの良い」目盛りを与える（軸ラベルが読みやすい値になる）。
 * 累積カウントの成長曲線なので 0 に貼り付けず、データ範囲にフィットさせて
 * 「伸び」を見えやすくする（下限は 0 未満にはしない）。
 */
function niceScale(min: number, max: number, intervals: number): { min: number; max: number; ticks: number[] } {
  if (min === max) {
    min = Math.max(0, min - 1)
    max = max + 1
  }
  // 語数は整数なので step も 1 以上の整数に丸める。小範囲（1〜3語）で 0.5 等の端数 step になると
  // Math.round 後に目盛りが重複し、同一 key・ラベル二重描画になる（早期利用の 2 点グラフで発生）。
  const step = Math.max(1, niceNum((max - min) / intervals, true))
  const niceMin = Math.max(0, Math.floor(min / step) * step)
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v))
  return { min: niceMin, max: niceMax, ticks }
}

/** M/D 表記（軸ラベル・ツールチップ用） */
function mmdd(date: string): string {
  const d = parseDate(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function GrowthChart({ points }: { points: GrowthPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<number | null>(null)
  // SVG の実レンダリング幅。ラベルの文字サイズ補正とツールチップのクランプに使う。
  const [chartW, setChartW] = useState(0)
  const [tipLeft, setTipLeft] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setChartW(e.contentRect.width)
    })
    ro.observe(el)
    setChartW(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  // 文字は viewBox 単位なので幅に比例して縮む（モバイルで 6px 未満になり読めない）。
  // 画面上の px を一定に保つよう user 単位を逆補正する（下限は素の px＝デスクトップの見えは不変）。
  const uf = (px: number) => (chartW > 0 ? Math.max(px, (px * VB_W) / chartW) : px)

  // ── スケール
  const t0 = parseDate(points[0].date).getTime()
  const t1 = parseDate(points[points.length - 1].date).getTime()
  const xOf = (date: string) =>
    PAD.left + (t1 === t0 ? PLOT_W / 2 : ((parseDate(date).getTime() - t0) / (t1 - t0)) * PLOT_W)

  const vals = points.flatMap((p) => [p.started, p.known])
  const y = niceScale(Math.min(...vals), Math.max(...vals), Y_INTERVALS)
  const yOf = (v: number) => PAD.top + PLOT_H - ((v - y.min) / (y.max - y.min)) * PLOT_H
  const baseY = PAD.top + PLOT_H

  // ── パス
  const line = (key: 'started' | 'known') =>
    points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.date).toFixed(1)},${yOf(p[key]).toFixed(1)}`).join(' ')
  const startedLine = line('started')
  const knownLine = line('known')
  // Known の下を緑で塗る（＝身についた語彙の質量）
  const knownArea = `M${xOf(points[0].date).toFixed(1)},${baseY} ${points
    .map((p) => `L${xOf(p.date).toFixed(1)},${yOf(p.known).toFixed(1)}`)
    .join(' ')} L${xOf(points[points.length - 1].date).toFixed(1)},${baseY} Z`
  // Started と Known の間（＝学習中でまだ身についていないぶん）を淡く塗る
  const band = `${points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.date).toFixed(1)},${yOf(p.started).toFixed(1)}`).join(' ')} ${[
    ...points,
  ]
    .reverse()
    .map((p) => `L${xOf(p.date).toFixed(1)},${yOf(p.known).toFixed(1)}`)
    .join(' ')} Z`

  // ── x 軸ラベル（最大6個・両端は必ず含む）
  const xLabelIdx: number[] = []
  if (points.length <= 6) {
    points.forEach((_, i) => xLabelIdx.push(i))
  } else {
    const n = 5
    for (let k = 0; k <= n; k++) xLabelIdx.push(Math.round((k / n) * (points.length - 1)))
  }

  const showMarkers = points.length <= MARKER_MAX

  // ── ホバー：ポインタ x から最寄りの点を選ぶ
  const onMove = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const vbx = ((e.clientX - rect.left) / rect.width) * VB_W
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < points.length; i++) {
        const d = Math.abs(xOf(points[i].date) - vbx)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      setActive(best)
    },
    [points],
  )
  const onLeave = useCallback(() => setActive(null), [])

  const ap = active !== null ? points[active] : null
  const apX = ap ? xOf(ap.date) : 0
  const last = points[points.length - 1]

  // ツールチップは実幅を測って端でクランプ（中央 translateX(-50%) のまま、箱全体を容器内に収める）。
  useLayoutEffect(() => {
    if (ap === null || !tipRef.current || chartW <= 0) {
      setTipLeft(null)
      return
    }
    const half = tipRef.current.offsetWidth / 2
    const anchor = (apX / VB_W) * chartW
    setTipLeft(Math.min(chartW - half - 4, Math.max(half + 4, anchor)))
  }, [ap, apX, chartW])

  return (
    <div className="growth-chart" style={{ touchAction: 'pan-y' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="growth-svg"
        role="img"
        aria-label={`Vocabulary growth: ${fmtNum(last.started)} words started, ${fmtNum(last.known)} known`}
      >
        <defs>
          <linearGradient id="growth-known-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--good)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--good)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* y 目盛り（recessive なグリッド＋左のラベル） */}
        {y.ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={yOf(t)}
              y2={yOf(t)}
              className="growth-grid"
            />
            <text
              x={PAD.left - 8}
              y={yOf(t)}
              className="growth-ylabel"
              style={{ fontSize: uf(12) }}
              dominantBaseline="middle"
              textAnchor="end"
            >
              {fmtNum(t)}
            </text>
          </g>
        ))}

        {/* 塗り：Known の下（緑）＋ Started〜Known の帯（淡いアクセント） */}
        <path d={knownArea} fill="url(#growth-known-fill)" />
        <path d={band} className="growth-band" />

        {/* 線：Known（緑）→ Started（青）の順で重ねる */}
        <path d={knownLine} className="growth-line growth-line--known" />
        <path d={startedLine} className="growth-line growth-line--started" />

        {/* 各点のマーカー（点数が少ないときだけ） */}
        {showMarkers &&
          points.map((p) => (
            <g key={p.date}>
              <circle cx={xOf(p.date)} cy={yOf(p.known)} r={3} className="growth-dot growth-dot--known" />
              <circle cx={xOf(p.date)} cy={yOf(p.started)} r={3} className="growth-dot growth-dot--started" />
            </g>
          ))}

        {/* x 軸ラベル */}
        {xLabelIdx.map((i) => (
          <text
            key={i}
            x={xOf(points[i].date)}
            y={VB_H - 12}
            className="growth-xlabel"
            style={{ fontSize: uf(12) }}
            textAnchor="middle"
          >
            {mmdd(points[i].date)}
          </text>
        ))}

        {/* 最終点の直接ラベル（凡例と併せ、色だけに頼らず値を示す） */}
        <text
          x={xOf(last.date)}
          y={yOf(last.started) - 9}
          className="growth-endlabel growth-endlabel--started"
          style={{ fontSize: uf(13) }}
          textAnchor="end"
        >
          {fmtNum(last.started)}
        </text>
        <text
          x={xOf(last.date)}
          y={yOf(last.known) + 16}
          className="growth-endlabel growth-endlabel--known"
          style={{ fontSize: uf(13) }}
          textAnchor="end"
        >
          {fmtNum(last.known)}
        </text>

        {/* ホバー：十字線＋強調ドット */}
        {ap && (
          <g pointerEvents="none">
            <line x1={apX} x2={apX} y1={PAD.top} y2={baseY} className="growth-crosshair" />
            <circle cx={apX} cy={yOf(ap.known)} r={5} className="growth-dot--known growth-dot-active" />
            <circle cx={apX} cy={yOf(ap.started)} r={5} className="growth-dot--started growth-dot-active" />
          </g>
        )}

        {/* ホバー検出用の透明オーバーレイ */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={PLOT_W}
          height={PLOT_H}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={onLeave}
        />
      </svg>

      {/* ツールチップ（HTML オーバーレイ。x に追従、実幅で端クランプ） */}
      {ap && (
        <div
          ref={tipRef}
          className="growth-tip"
          style={{ left: tipLeft != null ? `${tipLeft}px` : `${(apX / VB_W) * 100}%` }}
        >
          <div className="growth-tip-date">{mmdd(ap.date)}</div>
          <div className="growth-tip-row">
            <span className="growth-tip-dot growth-tip-dot--started" />
            Started <strong>{fmtNum(ap.started)}</strong>
          </div>
          <div className="growth-tip-row">
            <span className="growth-tip-dot growth-tip-dot--known" />
            Known <strong>{fmtNum(ap.known)}</strong>
          </div>
        </div>
      )}
    </div>
  )
}
