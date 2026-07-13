import { useRef, useState } from 'react'
import type { VocabCard } from '../../types'
import type { ReviewGrade } from '../../srs/scheduler'
import { useStudyBoard, type BoardTile } from './useStudyBoard'
import { useFitText } from './useFitText'
import { getRomaji } from '../../text/romaji'

export function StudyGrid({
  cards,
  onWordStarted,
}: {
  cards: VocabCard[]
  /** 初採点（new → 開始）が起きたときに発火。ヘッダー側の演出のためのカードの座標を渡すだけで、ヘッダーの存在は知らない。 */
  onWordStarted?: (rect: DOMRect) => void
}) {
  const b = useStudyBoard(cards)

  if (b.loading) return <div className="hint">Preparing your session…</div>
  if (b.empty)
    return (
      <div className="done">
        <div className="done-emoji">✓</div>
        <h2>All caught up</h2>
        <p>Nothing is due right now.</p>
        <button className="btn ghost" onClick={b.restart}>
          Reset progress (demo)
        </button>
      </div>
    )
  if (b.finished)
    return (
      <div className="done">
        <div className="done-emoji">🎉</div>
        <h2>Session complete</h2>
        <p>
          {b.reviewed} reviews{b.again > 0 ? ` · ${b.again} marked “Again”` : ''}
        </p>
        <button className="btn primary" onClick={b.restart}>
          Start another session
        </button>
      </div>
    )

  return (
    <div className="board">
      {b.tiles.map((t) => (
        <Tile
          key={t.card.id}
          tile={t}
          onGrade={async (g, rect) => {
            const wasNew = await b.grade(t.card.id, g)
            if (wasNew) onWordStarted?.(rect)
          }}
        />
      ))}
    </div>
  )
}

function Tile({ tile, onGrade }: { tile: BoardTile; onGrade: (g: ReviewGrade, rect: DOMRect) => void }) {
  const c: VocabCard = tile.card
  const gradable = tile.state !== 'done'
  const romaji = getRomaji(c.reading)
  // めくり（flip）はカード上部の「本体」に触れたときだけ起きる。下の「ボタン欄」に
  // マウスが入っても、本体から一度も入っていなければめくれない — カードが動いた
  // 直後にボタン位置がずれてクリックし損なう、という事態を防ぐため。
  const [flippedByHover, setFlippedByHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const flipped = gradable && (pinned || flippedByHover)
  const rootRef = useRef<HTMLDivElement>(null)

  const fire = (g: ReviewGrade) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) onGrade(g, rect)
  }

  const cls = `tile s-${tile.state}${flipped ? ' revealed' : ''}`

  return (
    <div className={cls} ref={rootRef} onMouseLeave={() => setFlippedByHover(false)}>
      <span className="tile-dot" />
      <div
        className="tile-content"
        onMouseEnter={() => gradable && setFlippedByHover(true)}
        onClick={() => gradable && setPinned((p) => !p)}
        role="button"
        aria-label={c.headword}
      >
        {flipped ? (
          <>
            <div className="tile-hw sm">{c.headword}</div>
            <span className="tile-reading">
              {c.reading}
              {romaji && <span className="tile-romaji"> · {romaji}</span>}
            </span>
            <FitGloss text={c.gloss} />
          </>
        ) : (
          <>
            <div className="tile-hw">{c.headword}</div>
            {tile.state === 'done' && <FitGloss text={c.gloss} className="done" big />}
          </>
        )}
      </div>
      {gradable && (
        <div className="tile-btn-zone">
          <div className="tile-levels">
            <button type="button" className="tile-level lvl-good" onClick={() => fire(flipped ? 'good' : 'easy')}>
              Got it
            </button>
            <button type="button" className="tile-level lvl-hard" onClick={() => fire('hard')}>
              Fuzzy
            </button>
            <button type="button" className="tile-level lvl-again" onClick={() => fire('again')}>
              Studying
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** done カードの緑グロス用の大きめサイズ段階。枠も広い（.tile-gloss-box.big＝高さ46px）ので大きく出せる。 */
const BIG_STEPS = [17, 16, 15, 14, 13, 12]

/** 訳語（可変長）を固定の高さ枠に収める。長い訳語は自動でフォントを縮める。
 *  big=true は done カードの緑グロス用で、枠を広げてフォントも一段大きくする。 */
function FitGloss({ text, className, big }: { text: string; className?: string; big?: boolean }) {
  const { boxRef, fontSize } = useFitText(text, big ? BIG_STEPS : undefined)
  return (
    <div ref={boxRef} className={`tile-gloss-box${big ? ' big' : ''}`}>
      <div className={`tile-gloss${className ? ` ${className}` : ''}`} style={{ fontSize }}>
        {text}
      </div>
    </div>
  )
}
