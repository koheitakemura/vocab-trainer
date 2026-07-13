import { useEffect, useState } from 'react'
import type { VocabCard } from '../../types'
import type { ReviewGrade } from '../../srs/scheduler'
import { useStudyBoard, type BoardTile } from './useStudyBoard'
import { SpeakerButton } from '../../audio/SpeakerButton'
import { speakJapanese } from '../../audio/speak'
import { getAutoplayPref } from '../../audio/audioPrefs'

export function StudyGrid({ cards }: { cards: VocabCard[] }) {
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
        <Tile key={t.card.id} tile={t} onGrade={(g) => b.grade(t.card.id, g)} />
      ))}
    </div>
  )
}

function Tile({ tile, onGrade }: { tile: BoardTile; onGrade: (g: ReviewGrade) => void }) {
  const c: VocabCard = tile.card
  const gradable = tile.state !== 'done'
  // めくり（flip）はカード上部の「本体」に触れたときだけ起きる。下の「ボタン欄」に
  // マウスが入っても、本体から一度も入っていなければめくれない — カードが動いた
  // 直後にボタン位置がずれてクリックし損なう、という事態を防ぐため。
  const [flippedByHover, setFlippedByHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const flipped = gradable && (pinned || flippedByHover)

  // listening-first（PLAN §4.1）: めくるたびに発音を聞かせる
  useEffect(() => {
    if (!flipped || !getAutoplayPref()) return
    speakJapanese(c.reading || c.headword, { audioUrl: c.audioUrl })
  }, [flipped])

  const cls = `tile s-${tile.state}${flipped ? ' revealed' : ''}`

  return (
    <div className={cls} onMouseLeave={() => setFlippedByHover(false)}>
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
            <div className="tile-reading-row">
              <span className="tile-reading">{c.reading}</span>
              <SpeakerButton text={c.reading || c.headword} audioUrl={c.audioUrl} />
            </div>
            <div className="tile-gloss">{c.gloss}</div>
          </>
        ) : (
          <>
            <div className="tile-hw">{c.headword}</div>
            {tile.state === 'done' && <div className="tile-gloss done">{c.gloss}</div>}
          </>
        )}
      </div>
      {gradable && (
        <div className="tile-btn-zone">
          {flipped ? (
            <div className="tile-levels">
              <button type="button" className="tile-level lvl-good" onClick={() => onGrade('good')}>
                I know
              </button>
              <button type="button" className="tile-level lvl-hard" onClick={() => onGrade('hard')}>
                Sort of know
              </button>
              <button type="button" className="tile-level lvl-again" onClick={() => onGrade('again')}>
                Still learning
              </button>
            </div>
          ) : (
            <button type="button" className="tile-know" onClick={() => onGrade('easy')}>
              I know
            </button>
          )}
        </div>
      )}
    </div>
  )
}
