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

  // キーボード：Space/Enter=めくる（未めくり時）／めくり後は 1=Still learning・2=Sort of know・3かSpace=I know
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (b.loading || b.empty || b.finished || !b.activeId) return
      if (!b.revealed) {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault()
          b.reveal()
        }
      } else {
        if (e.key === '1') b.grade(b.activeId, 'again')
        else if (e.key === '2') b.grade(b.activeId, 'hard')
        else if (e.key === '3' || e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault()
          b.grade(b.activeId, 'good')
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
          onGrade={(g) => b.grade(t.card.id, g)}
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
  const gradable = tile.state !== 'done'
  // フリップ前（または未選択のまま）に I know を押す＝一切見ずに即スキップ＝Easy。
  // フリップ後に押す＝答えを見て「知ってた」を確認＝Good。
  const knowGrade: ReviewGrade = active && revealed ? 'good' : 'easy'

  const handleClick = () => {
    if (!active) {
      onFocus() // 最初のタップで選択とめくりを同時に行う
      return
    }
    if (!revealed) onReveal()
    // 既に revealed なら本体タップは何もしない（採点は明示的なボタンで行う）
  }

  const know = gradable && (
    <button
      type="button"
      className="tile-know"
      onClick={(e) => {
        e.stopPropagation()
        onGrade(knowGrade)
      }}
    >
      I know
    </button>
  )

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
          {gradable && (
            <div className="tile-levels" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="tile-level lvl-again" onClick={() => onGrade('again')}>
                Still learning
              </button>
              <button type="button" className="tile-level lvl-hard" onClick={() => onGrade('hard')}>
                Sort of know
              </button>
              <button type="button" className="tile-level lvl-good" onClick={() => onGrade('good')}>
                I know
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
          {know}
        </>
      )}
    </div>
  )
}
