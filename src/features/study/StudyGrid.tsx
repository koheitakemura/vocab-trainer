import { useRef, useState } from 'react'
import type { VocabCard } from '../../types'
import type { ReviewGrade } from '../../srs/scheduler'
import { gradeLevel, LEVEL_LABEL } from '../../srs/levels'
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
        <button className="btn ghost" onClick={b.reset}>
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
            const sparkle = await b.grade(t.card.id, g)
            if (sparkle) onWordStarted?.(rect)
          }}
        />
      ))}
    </div>
  )
}

function Tile({ tile, onGrade }: { tile: BoardTile; onGrade: (g: ReviewGrade, rect: DOMRect) => void }) {
  const c: VocabCard = tile.card
  const romaji = getRomaji(c.reading)
  // どのカードも採点後もボタンを残し、いつでも採点しなおせる（3ボタン共通の挙動）。
  // 意味（訳語）は常時表示せず、本体にホバー/タップしてめくったときだけ見せる。
  // ホバーめくりは「マウスのポインターイベント」だけに反応させる：タッチはタップ時に
  // mouseenter をエミュレートするくせに mouseleave を出さないため、デバイス単位の判定では
  // ハイブリッド端末（タッチ付きラップトップ等）で「めくれたまま戻せない」が残る。
  // pointerType でイベント単位に見分ければ全端末で正しく、タッチはタップのトグルだけになる。
  const [flippedByHover, setFlippedByHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const flipped = pinned || flippedByHover
  const rootRef = useRef<HTMLDivElement>(null)

  const fire = (g: ReviewGrade) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) onGrade(g, rect)
  }

  // 直近に押したボタンの評価から表示レベル（色・枠線）を決める。未採点は null（枠は既定色）。
  const level = tile.grade ? gradeLevel(tile.grade) : null
  // 右上マークは未採点なら "New"（グレー）、採点済みならその評価の色・ラベル。
  const markKind = level ?? 'new'
  const markLabel = level ? LEVEL_LABEL[level] : 'New'
  const cls = `tile s-${tile.state}${flipped ? ' revealed' : ''}${level ? ` g-${level}` : ''}`

  return (
    <div className={cls} ref={rootRef} onMouseLeave={() => setFlippedByHover(false)}>
      <span className={`tile-mark tile-mark--${markKind}`}>
        <span className="tile-mark-label">{markLabel}</span>
        <span className="tile-mark-dot" />
      </span>
      <div
        className="tile-content"
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') setFlippedByHover(true)
        }}
        onClick={() => setPinned((p) => !p)}
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
          <div className="tile-hw">{c.headword}</div>
        )}
      </div>
      <div className="tile-btn-zone">
        <div className="tile-levels">
          <button type="button" className="tile-level lvl-good" onClick={() => fire(flipped ? 'good' : 'easy')}>
            I know
          </button>
          <button type="button" className="tile-level lvl-hard" onClick={() => fire('hard')}>
            Fuzzy
          </button>
          <button type="button" className="tile-level lvl-again" onClick={() => fire('again')}>
            Studying
          </button>
        </div>
      </div>
    </div>
  )
}

/** 訳語（可変長）を固定の高さ枠に収める。長い訳語は自動でフォントを縮める。 */
function FitGloss({ text, className }: { text: string; className?: string }) {
  const { boxRef, fontSize } = useFitText(text)
  return (
    <div ref={boxRef} className="tile-gloss-box">
      <div className={`tile-gloss${className ? ` ${className}` : ''}`} style={{ fontSize }}>
        {text}
      </div>
    </div>
  )
}
