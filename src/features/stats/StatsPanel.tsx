import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Course, VocabCard } from '../../types'
import { db } from '../../store/db'
import { safeGet, safeSet } from '../../store/safeStorage'
import { isKnownRow } from '../../srs/levels'
import { retrievabilityOf } from '../../srs/scheduler'
import { coverageAt } from '../../data/coverage'
import { fmtNum } from '../../text/format'
import { CATEGORIES, GROUP_LABEL, GROUP_ORDER } from '../../data/categories'

type JlptLevel = NonNullable<VocabCard['jlptLevel']>
const JLPT_ORDER: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']

/**
 * Stats タブ。JLPT レベル別の達成リング＋コンプリートバッジ、
 * そして**カテゴリー別の習得率**（Topics / 表現 / 文法のグループごとに、覚えた語/総語のバー）。
 * データはこのタブを開いている間だけコースの progress 行を1回スキャンする（タブ外コストゼロ）。
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

  // カテゴリー別の総語数と、カード→カテゴリーの対応。
  const catOf = useMemo(() => new Map(cards.filter((c) => c.category).map((c) => [c.id, c.category as string])), [cards])
  const totalByCat = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cards) if (c.category) m.set(c.category, (m.get(c.category) ?? 0) + 1)
    return m
  }, [cards])

  const data = useLiveQuery(
    async () => {
      const rows = await db.progress.where('courseId').equals(course.id).toArray()
      const now = new Date()
      const known = new Map<JlptLevel, number>()
      const knownByCat = new Map<string, number>()
      let sumR = 0
      let mastered = 0
      let started = 0
      for (const r of rows) {
        if (r.status === 'new') continue
        started++
        sumR += retrievabilityOf(r.fsrs, now)
        if (r.status === 'burned') mastered++
        if (isKnownRow(r)) {
          // 「I know」の定義はヘッダーの内訳と同一（isKnownRow に一元化）
          const lvl = jlptOf.get(r.cardId)
          if (lvl) known.set(lvl, (known.get(lvl) ?? 0) + 1)
          const cat = catOf.get(r.cardId)
          if (cat) knownByCat.set(cat, (knownByCat.get(cat) ?? 0) + 1)
        }
      }
      return { known, knownByCat, sumR, mastered, started }
    },
    [course.id, jlptOf, catOf],
  )

  // レベルコンプリートのバッジは render でなく effect で永続化する（render は純粋に保つ。ラチェット）。
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

  // グループ→存在するカテゴリー（総語数付き）
  const catGroups = useMemo(
    () =>
      GROUP_ORDER.map((g) => ({
        group: g,
        cats: CATEGORIES.filter((c) => c.group === g && (totalByCat.get(c.key) ?? 0) > 0),
      })).filter((x) => x.cats.length > 0),
    [totalByCat],
  )

  const levels = JLPT_ORDER.filter((l) => (totals.get(l) ?? 0) > 0)
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
          In long-term memory <strong>{fmtNum(est)}</strong>
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

      {levels.length > 0 && (
        <>
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
        </>
      )}

      {catGroups.length > 0 && (
        <>
          <h3 className="stats-heading">Mastery by category</h3>
          {catGroups.map(({ group, cats }) => (
            <div key={group} className="cat-stat-group">
              <div className="cat-stat-grouplabel">{GROUP_LABEL[group]}</div>
              {cats.map((c) => {
                const total = totalByCat.get(c.key) ?? 0
                const known = data.knownByCat.get(c.key) ?? 0
                const pct = total > 0 ? Math.round((known / total) * 100) : 0
                return (
                  <div key={c.key} className={`cat-stat-row${known >= total ? ' done' : ''}`}>
                    <span className="cat-stat-name">
                      <span className="cat-stat-emoji">{c.emoji}</span>
                      {c.label}
                    </span>
                    <span className="cat-stat-bar">
                      <span className="cat-stat-fill" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="cat-stat-num">
                      {fmtNum(known)}/{fmtNum(total)}
                    </span>
                    <span className="cat-stat-pct">{pct}%</span>
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}
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
