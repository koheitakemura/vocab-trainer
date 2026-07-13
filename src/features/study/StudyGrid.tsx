import { useEffect } from 'react'
import type { VocabCard } from '../../types'
import type { ReviewGrade } from '../../srs/scheduler'
import { useStudyBoard, type BoardTile } from './useStudyBoard'
import { SpeakerButton } from '../../audio/SpeakerButton'
import { speakJapanese } from '../../audio/speak'
import { getAutoplayPref } from '../../audio/audioPrefs'

export function StudyGrid({ cards }: { cards: VocabCard[] }) {
  const b = useStudyBoard(cards)

  // listening-first（PLAN §4.1）: 新規カードが active になったら、めくる前に自動で発音を聞かせる
  useEffect(() => {
    if (!b.active || b.revealed || !getAutoplayPref()) return
    speakJapanese(b.active.reading || b.active.headword, { audioUrl: b.active.audioUrl })
  }, [b.activeId])

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
    if (!active) {
      onFocus()
      return
    }
    if (tile.state !== 'done' && !revealed) onReveal()
    // 既に active かつ revealed（採点待ち、または回答済みを見返し中）は何もしない
  }
  // 回答済みタイルを選び直したときは常に revealed=true で表示されるので、
  // グレーディングの余地は無い＝ボタンは出さず「閲覧のみ」にする
  const showGrade = revealed && tile.state !== 'done'

  return (
    <div className={cls} onClick={handleClick} role="button" aria-label={c.headword}>
      <span className="tile-dot" />
      {revealed ? (
        <>
          <div className="tile-hw sm">{c.headword}</div>
          <div className="tile-reading-row">
            <span className="tile-reading">{c.reading}</span>
            <SpeakerButton text={c.reading || c.headword} audioUrl={c.audioUrl} />
          </div>
          <div className="tile-gloss">{c.gloss}</div>
          {showGrade && (
            <div className="tile-grade" onClick={(e) => e.stopPropagation()}>
              <button className="btn again" onClick={() => onGrade('again')}>
                Again
              </button>
              <button className="btn good" onClick={() => onGrade('good')}>
                Good
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="tile-hw">{c.headword}</div>
          {tile.state === 'done' ? (
            <div className="tile-gloss done">{c.gloss}</div>
          ) : active ? (
            <div className="tile-hint-row">
              <span className="tile-hint">tap / Space</span>
              <SpeakerButton text={c.reading || c.headword} audioUrl={c.audioUrl} label="Replay pronunciation" />
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
