import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { VocabCard, WordStatus } from '../../types'
import { db } from '../../store/db'

type StatusGroup = 'new' | 'learning' | 'known'

function statusGroup(s: WordStatus): StatusGroup {
  if (s === 'known' || s === 'burned') return 'known'
  if (s === 'new') return 'new'
  return 'learning'
}

/** 案④ Dense List — コースの全語を一覧俯瞰。行クリックで例文を展開。 */
export function AllWords({ cards }: { cards: VocabCard[] }) {
  const statusById = useLiveQuery(
    async () => {
      const rows = await db.progress.toArray()
      return new Map(rows.map((r) => [r.cardId, r.status]))
    },
    [],
    new Map<string, WordStatus>(),
  )
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className="allwords">
      <div className="aw-head">
        <span>#</span>
        <span>Word</span>
        <span>Reading</span>
        <span>Meaning</span>
        <span>Status</span>
      </div>
      {cards.map((c) => {
        const group = statusGroup(statusById?.get(c.id) ?? 'new')
        const isOpen = open === c.id
        return (
          <div key={c.id} className={`aw-item${isOpen ? ' open' : ''}`}>
            <div className="aw-row" onClick={() => setOpen(isOpen ? null : c.id)} role="button">
              <span className="aw-num">{c.frequencyRank}</span>
              <span className="aw-word">{c.headword}</span>
              <span className="aw-reading">{c.reading}</span>
              <span className="aw-gloss">{c.gloss}</span>
              <span className={`aw-pill st-${group}`}>{group}</span>
            </div>
            {isOpen && (
              <div className="aw-ex">
                <span className="aw-pos">{c.pos}</span>
                {c.examples.map((ex, i) => (
                  <div key={i} className="aw-exline">
                    <span>{ex.text}</span>
                    <span className="aw-exen">{ex.translation}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
