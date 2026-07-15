import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { VocabCard, WordStatus } from '../../types'
import { db } from '../../store/db'
import { getRomaji } from '../../text/romaji'
import { CATEGORIES, CATEGORY_BY_KEY, GROUP_LABEL, GROUP_ORDER } from '../../data/categories'
import { useStrings, type UiLanguage, type UIStrings } from '../../text/i18n'

type StatusGroup = 'new' | 'learning' | 'known' | 'mastered'

function statusGroup(s: WordStatus): StatusGroup {
  if (s === 'burned') return 'mastered' // 卒業（金）＝レビューキューから恒久除外
  if (s === 'known') return 'known'
  if (s === 'new') return 'new'
  return 'learning'
}

/** ステータスのピル表示ラベル（新規/学習中/既知/卒業）。採点ラベル・単語一覧フィルターとキーを共有する */
function statusLabel(s: StatusGroup, t: UIStrings): string {
  if (s === 'new') return t.statusNew
  if (s === 'learning') return t.statusLearning
  if (s === 'known') return t.statusKnown
  return t.mastered
}

const norm = (s: string) => s.toLowerCase().trim()

/** 案④ Dense List — コースの全語を一覧俯瞰。カテゴリー列＋各列フィルター付き。行クリックで例文を展開。 */
export function AllWords({ cards, uiLanguage }: { cards: VocabCard[]; uiLanguage: UiLanguage }) {
  const t = useStrings(uiLanguage)
  const STATUS_OPTIONS: { value: StatusGroup; label: string }[] = [
    { value: 'new', label: t.statusNew },
    { value: 'learning', label: t.statusLearning },
    { value: 'known', label: t.statusKnown },
    { value: 'mastered', label: t.mastered },
  ]
  const statusById = useLiveQuery(
    async () => {
      const rows = await db.progress.toArray()
      return new Map(rows.map((r) => [r.cardId, r.status]))
    },
    [],
    new Map<string, WordStatus>(),
  )
  const [open, setOpen] = useState<string | null>(null)
  // 各列フィルター
  const [fWord, setFWord] = useState('')
  const [fReading, setFReading] = useState('')
  const [fMeaning, setFMeaning] = useState('')
  const [fCat, setFCat] = useState('')
  const [fStatus, setFStatus] = useState('')

  // カテゴリー選択肢：コースに実在するものだけ、グループごとに
  const catGroups = useMemo(() => {
    const present = new Set<string>()
    for (const c of cards) if (c.category) present.add(c.category)
    return GROUP_ORDER.map((g) => ({
      group: g,
      cats: CATEGORIES.filter((c) => c.group === g && present.has(c.key)),
    })).filter((x) => x.cats.length > 0)
  }, [cards])

  const filtered = useMemo(() => {
    const w = norm(fWord)
    const r = norm(fReading)
    const m = norm(fMeaning)
    return cards.filter((c) => {
      if (w && !norm(c.headword).includes(w)) return false
      if (r && !(norm(c.reading ?? '').includes(r) || norm(getRomaji(c.reading) ?? '').includes(r))) return false
      if (m && !norm(c.gloss).includes(m)) return false
      if (fCat && (c.category ?? '') !== fCat) return false
      if (fStatus && statusGroup(statusById?.get(c.id) ?? 'new') !== fStatus) return false
      return true
    })
  }, [cards, fWord, fReading, fMeaning, fCat, fStatus, statusById])

  const anyFilter = !!(fWord || fReading || fMeaning || fCat || fStatus)

  return (
    <div className="allwords-scroll">
      <div className="allwords">
        {/* ヘッダーとフィルターを1行に統合：各列のフィルター自体が見出し（列名＝プレースホルダー） */}
        <div className="aw-filter">
          <span className="aw-filter-count" title={anyFilter ? t.matchingWords : undefined}>
            {anyFilter ? filtered.length : '#'}
          </span>
          <input className="aw-fin" placeholder={t.filterWord} value={fWord} onChange={(e) => setFWord(e.target.value)} aria-label={t.filterByWord} />
          <input className="aw-fin" placeholder={t.filterReading} value={fReading} onChange={(e) => setFReading(e.target.value)} aria-label={t.filterByReading} />
          <input className="aw-fin" placeholder={t.filterMeaning} value={fMeaning} onChange={(e) => setFMeaning(e.target.value)} aria-label={t.filterByMeaning} />
          <select className={`aw-fsel${fCat ? ' on' : ''}`} value={fCat} onChange={(e) => setFCat(e.target.value)} aria-label={t.filterByCategory}>
            <option value="">{t.filterCategory}</option>
            {catGroups.map(({ group, cats }) => (
              <optgroup key={group} label={GROUP_LABEL[group]}>
                {cats.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select className={`aw-fsel${fStatus ? ' on' : ''}`} value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label={t.filterByStatus}>
            <option value="">{t.filterStatus}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="aw-empty">{t.noWordsMatch}</div>
        ) : (
          filtered.map((c) => {
            const group = statusGroup(statusById?.get(c.id) ?? 'new')
            const isOpen = open === c.id
            const romaji = getRomaji(c.reading)
            const cat = c.category ? CATEGORY_BY_KEY[c.category] : undefined
            return (
              <div key={c.id} className={`aw-item${isOpen ? ' open' : ''}`}>
                <div className="aw-row" onClick={() => setOpen(isOpen ? null : c.id)} role="button">
                  <span className="aw-num">{c.frequencyRank}</span>
                  <span className="aw-word">{c.headword}</span>
                  <span className="aw-reading">
                    {c.reading}
                    {romaji && <span className="aw-romaji"> · {romaji}</span>}
                  </span>
                  <span className="aw-gloss">{c.gloss}</span>
                  <span className="aw-cat">
                    {cat ? (
                      <>
                        <span className="aw-cat-emoji">{cat.emoji}</span>
                        <span className="aw-cat-label">{cat.label}</span>
                      </>
                    ) : (
                      <span className="aw-cat-none">—</span>
                    )}
                  </span>
                  <span className={`aw-pill st-${group}`}>{statusLabel(group, t)}</span>
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
          })
        )}
      </div>
    </div>
  )
}
