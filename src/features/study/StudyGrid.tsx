import { useEffect } from 'react'
import type { VocabCard } from '../../types'
import type { ReviewGrade } from '../../srs/scheduler'
import { useStudyBoard, type BoardTile } from './useStudyBoard'

export function StudyGrid({ cards }: { cards: VocabCard[] }) {
  const b = useStudyBoard(cards)

  // キーボード：Space/Enter=めくる、1=Again、2/Space=Good
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (b.loading || b.empty || b.finished || !b.activeId) return
      if (!b.revealed) {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault()
          b.reveal()
        }
      } else {
        if (e.key === '1') b.grade('again')
        else if (e.key === '2' || e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault()
          b.grade('good')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
          active={t.card.id === b.activeId}
          revealed={b.revealed && t.card.id === b.activeId}
          onReveal={b.reveal}
          onFocus={() => b.focusTile(t.card.id)}
          onGrade={b.grade}
        />
      ))}
    </div>
  )
}

function Tile({
  tile,
  active,
  revealed,
  onReveal,
  onFocus,
  onGrade,
}: {
  tile: BoardTile
  active: boolean
  revealed: boolean
  onReveal: () => void
  onFocus: () => void
  onGrade: (g: ReviewGrade) => void
}) {
  const c: VocabCard = tile.card
  const cls = `tile s-${tile.state}${active ? ' active' : ''}${revealed ? ' revealed' : ''}`
  const handleClick = () => {
    if (active) onReveal()
    else onFocus()
  }

  return (
    <div className={cls} onClick={revealed ? undefined : handleClick} role="button" aria-label={c.headword}>
      <span className="tile-dot" />
      {revealed ? (
        <>
          <div className="tile-hw sm">{c.headword}</div>
          <div className="tile-reading">{c.reading}</div>
          <div className="tile-gloss">{c.gloss}</div>
          <div className="tile-grade" onClick={(e) => e.stopPropagation()}>
            <button className="btn again" onClick={() => onGrade('again')}>
              Again
            </button>
            <button className="btn good" onClick={() => onGrade('good')}>
              Good
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="tile-hw">{c.headword}</div>
          {tile.state === 'done' ? (
            <div className="tile-gloss done">{c.gloss}</div>
          ) : active ? (
            <div className="tile-hint">tap / Space</div>
          ) : null}
        </>
      )}
    </div>
  )
}
