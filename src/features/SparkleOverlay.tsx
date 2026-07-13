import { useEffect, useMemo } from 'react'

export interface BurstSpec {
  id: number
  sourceRect: DOMRect
  targetRect: DOMRect
}

const STAR_COUNT = 18
const GLYPHS = ['✦', '✧', '✦', '✧', '⋆', '✦']
const COLORS = ['var(--accent)', 'var(--good)', 'var(--easy)', '#ffffff']
/** 粒の基本飛翔時間（ms）。バーストの片付け・数字ポンのタイミングもここから導く。 */
const FLIGHT_MS = 720

/**
 * 新規語を初採点したときにカードからヘッダーの数字へ飛ぶ「きらきら」演出。
 * 動きは2段構え：①カード中心から全方位に弾け出す ②各自の弧で加速しながらカウンターへ吸い込まれる。
 * 回転は付けない（星は瞬くもので、回すと歯車のように見えて不自然）＝拡大縮小＋発光で瞬きを表現。
 */
export function SparkleOverlay({
  bursts,
  onArrive,
  onDone,
}: {
  bursts: BurstSpec[]
  onArrive: () => void
  onDone: (id: number) => void
}) {
  if (bursts.length === 0) return null
  return (
    <>
      {bursts.map((b) => (
        <SparkleBurst key={b.id} burst={b} onArrive={onArrive} onDone={onDone} />
      ))}
    </>
  )
}

function SparkleBurst({
  burst,
  onArrive,
  onDone,
}: {
  burst: BurstSpec
  onArrive: () => void
  onDone: (id: number) => void
}) {
  const sx = burst.sourceRect.left + burst.sourceRect.width / 2
  const sy = burst.sourceRect.top + burst.sourceRect.height / 2
  const dx = burst.targetRect.left + burst.targetRect.width / 2 - sx
  const dy = burst.targetRect.top + burst.targetRect.height / 2 - sy

  const stars = useMemo(
    () =>
      Array.from({ length: STAR_COUNT }, () => {
        // ① バースト：カード中心から全方位にランダムに弾ける（円状に散らす）
        const angle = Math.random() * Math.PI * 2
        const radius = 34 + Math.random() * 62
        return {
          bx: Math.cos(angle) * radius,
          by: Math.sin(angle) * radius,
          // ② 吸い込み：着地点を粒ごとに少しばらけさせ、一点収束の「線」化を防ぐ
          tjx: (Math.random() - 0.5) * 26,
          tjy: (Math.random() - 0.5) * 22,
          delay: Math.random() * 150,
          dur: FLIGHT_MS + Math.random() * 90,
          size: 9 + Math.random() * 10,
          glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        }
      }),
    [],
  )

  // 粒の大半がカウンターに吸い込まれる頃に数字を弾ませる。
  useEffect(() => {
    const t = setTimeout(onArrive, FLIGHT_MS * 0.82)
    return () => clearTimeout(t)
  }, [onArrive])

  const burstStyle = {
    left: sx,
    top: sy,
    '--dx': `${dx}px`,
    '--dy': `${dy}px`,
  } as React.CSSProperties

  return (
    <div className="burst" style={burstStyle}>
      {stars.map((p, i) => (
        <span
          key={i}
          className="spark"
          style={
            {
              '--bx': `${p.bx}px`,
              '--by': `${p.by}px`,
              '--tjx': `${p.tjx}px`,
              '--tjy': `${p.tjy}px`,
              '--delay': `${p.delay}ms`,
              '--dur': `${p.dur}ms`,
              '--size': `${p.size}px`,
              color: p.color,
            } as React.CSSProperties
          }
        >
          {p.glyph}
        </span>
      ))}
      {/* 片付け専用の不可視要素：全粒が終わる頃に1回だけ onAnimationEnd を発火させる */}
      <span className="burst-sentinel" style={{ animationDelay: `${FLIGHT_MS + 260}ms` }} onAnimationEnd={() => onDone(burst.id)} />
    </div>
  )
}
