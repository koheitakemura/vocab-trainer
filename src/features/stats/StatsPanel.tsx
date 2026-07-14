import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Course, VocabCard } from '../../types'
import { db } from '../../store/db'
import { safeGet, safeSet } from '../../store/safeStorage'
import { isKnownRow } from '../../srs/levels'
import { retrievabilityOf } from '../../srs/scheduler'
import { coverageAt } from '../../data/coverage'
import { fmtNum } from '../../text/format'

type JlptLevel = NonNullable<VocabCard['jlptLevel']>
const JLPT_ORDER: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']

/**
 * Stats タブ。JLPT レベル別の達成リング（近接下位目標: 遠い3,075語を「まず N5 の約680語」に分割）
 * ＋コンプリートバッジ（localStorage ラチェット＝一度獲得したら known が減っても消えない）。
 * データはこのタブを開いている間だけコースの progress 行をスキャンする（タブ外コストゼロ）。
 */
export function StatsPanel({ course, cards }: { course: Course; cards: VocabCard[] }) {
  const totals = useMemo(() => {
    const m = new Map<JlptLevel, number>()
    for (const c of cards) if (c.jlptLevel) m.set(c.jlptLevel, (m.get(c.jlptLevel) ?? 0) + 1)
    return m
  }, [cards])
  const jlptOf = useMemo(
    () => new Map(cards.filter((c) => c.jlptLevel).map((c) => [c.id, c.jlptLevel as JlptLevel])),
    [cards],
  )

  const data = useLiveQuery(
    async () => {
      const rows = await db.progress.where('courseId').equals(course.id).toArray()
      const now = new Date()
      const known = new Map<JlptLevel, number>()
      let sumR = 0
      let mastered = 0
      let started = 0
      for (const r of rows) {
        if (r.status === 'new') continue
        started++
        sumR += retrievabilityOf(r.fsrs, now)
        if (r.status === 'burned') mastered++
        // 「I know」の定義はヘッダーの内訳と同一（isKnownRow に一元化）
        const lvl = jlptOf.get(r.cardId)
        if (lvl && isKnownRow(r)) known.set(lvl, (known.get(lvl) ?? 0) + 1)
      }
      return { known, sumR, mastered, started }
    },
    [course.id, jlptOf],
  )

  // レベルコンプリートのバッジは render でなく effect で永続化する（render は純粋に保つ。
  // ラチェット＝一度書いたら known が後退しても消さない）。
  const completed = useMemo(() => {
    if (!data) return [] as JlptLevel[]
    return JLPT_ORDER.filter((l) => {
      const t = totals.get(l) ?? 0
      return t > 0 && (data.known.get(l) ?? 0) >= t
    })
  }, [data, totals])
  useEffect(() => {
    for (const l of completed) safeSet(`vt:badge:${course.id}:${l}`, '1')
  }, [completed, course.id])

  const levels = JLPT_ORDER.filter((l) => (totals.get(l) ?? 0) > 0)
  if (levels.length === 0) return <div className="hint">No level data for this course.</div>
  if (!data) return <div className="hint">Loading stats…</div>

  const est = Math.round(data.sumR)
  const earned = levels.filter((l) => completed.includes(l) || safeGet(`vt:badge:${course.id}:${l}`) === '1')

  return (
    <div className="stats-panel">
      <div className="stats-overview">
        <span>
          Words started <strong>{fmtNum(data.started)}</strong>
        </span>
        <span>
          In memory <strong>{fmtNum(est)}</strong>
        </span>
        <span>
          Everyday conversation <strong>{coverageAt(est)}%</strong>
        </span>
        {data.mastered > 0 && (
          <span>
            Mastered <strong className="stats-gold">{fmtNum(data.mastered)}</strong>
          </span>
        )}
      </div>

      <h3 className="stats-heading">JLPT vocabulary</h3>
      <div className="jlpt-rings">
        {levels.map((l) => (
          <JlptRing key={l} level={l} known={data.known.get(l) ?? 0} total={totals.get(l) ?? 0} />
        ))}
      </div>
      {earned.length > 0 && (
        <div className="badge-row">
          {earned.map((l) => (
            <span key={l} className="jlpt-badge">
              🏅 {l} vocabulary complete
            </span>
          ))}
        </div>
      )}
      <p className="jlpt-disclaimer">Level mapping is based on unofficial community JLPT word lists.</p>
    </div>
  )
}

function JlptRing({ level, known, total }: { level: JlptLevel; known: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.floor((known / total) * 100)) : 0
  const complete = total > 0 && known >= total
  return (
    <div className={`jlpt-ring${complete ? ' complete' : ''}`}>
      <div
        className="jlpt-ring-circle"
        style={{ background: `conic-gradient(var(--ring-fill) ${pct}%, var(--ring-track) 0)` }}
        role="img"
        aria-label={`${level}: ${known} of ${total} words known`}
      >
        <div className="jlpt-ring-hole">
          <div className="jlpt-ring-level">{level}</div>
          <div className="jlpt-ring-pct">{complete ? '100%' : `${pct}%`}</div>
        </div>
      </div>
      <div className="jlpt-ring-count">
        {fmtNum(known)} / {fmtNum(total)}
      </div>
    </div>
  )
}
