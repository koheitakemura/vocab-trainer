import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { VocabCard, WordStatus } from '../../types'
import { db } from '../../store/db'
import { getRomaji } from '../../text/romaji'
import { CATEGORIES, CATEGORY_BY_KEY, GROUP_LABEL, GROUP_ORDER } from '../../data/categories'
import { useStrings, type UiLanguage, type UIStrings } from '../../text/i18n'
import { ReportButton } from '../report/ReportButton'

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
export function AllWords({
  cards,
  uiLanguage,
  openId,
  onOpenIdHandled,
}: {
  cards: VocabCard[]
  uiLanguage: UiLanguage
  /** 検索（WordSearch）から開いてほしいカードID。渡されたら展開＋スクロールし、消費したら親へ通知する */
  openId?: string | null
  onOpenIdHandled?: () => void
}) {
  const t = useStrings(uiLanguage)
  const STATUS_OPTIONS: { value: StatusGroup; label: string }[] = [
    { value: 'new', label: t.statusNew },
    { value: 'learning', label: t.statusLearning },
    { value: 'known', label: t.statusKnown },
    { value: 'mastered', label: t.mastered },
  ]
  // 表示中コースの進捗行だけを見る（courseId はインデックス済み・db.ts参照）。
  // 以前は db.progress 全件（他コース分も含む）を毎回スキャンしていたため、
  // 学習が進むほど・他コースを増やすほどこのタブが重くなる不要な依存があった。
  const courseId = cards[0]?.courseId
  const statusById = useLiveQuery(
    async () => {
      if (!courseId) return new Map<string, WordStatus>()
      const rows = await db.progress.where('courseId').equals(courseId).toArray()
      return new Map(rows.map((r) => [r.cardId, r.status]))
    },
    [courseId],
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

  // 仮想スクロール（最大3万語規模のコースで全行を一度にDOM化すると重くなるため）。
  // ページ自体がスクロールする既存レイアウトを変えずに済む useWindowVirtualizer を使う
  // （固定高のスクロール枠を新設しない）。行は通常40px固定だが展開時は可変高になるため
  // measureElement で実測させる（estimateSize は初期見積もりのみ）。
  const listRef = useRef<HTMLDivElement>(null)
  const listOffsetRef = useRef(0)
  useLayoutEffect(() => {
    listOffsetRef.current = listRef.current?.offsetTop ?? 0
  }, [])
  const rowVirtualizer = useWindowVirtualizer({
    count: filtered.length,
    estimateSize: () => 40,
    overscan: 8,
    scrollMargin: listOffsetRef.current,
  })

  // 検索から開いてほしいカードが来たら展開し、フィルターに隠れていれば全解除する
  // （フィルターをかけたままだと filtered から消えてスクロール先が見つからないため）。
  useEffect(() => {
    if (!openId) return
    setOpen(openId)
    setFWord('')
    setFReading('')
    setFMeaning('')
    setFCat('')
    setFStatus('')
  }, [openId])

  // 上の effect でフィルターが解除されて filtered が openId を含むようになった時点でスクロールする。
  // 消費（onOpenIdHandled）は展開が完了してから呼ぶ——呼んだ瞬間 openId が親側で null に戻っても
  // ローカルの open（展開状態）は別 state なので開いたままになる。
  useEffect(() => {
    if (!openId) return
    const idx = filtered.findIndex((c) => c.id === openId)
    if (idx === -1) return
    rowVirtualizer.scrollToIndex(idx, { align: 'center' })
    onOpenIdHandled?.()
  }, [openId, filtered, rowVirtualizer, onOpenIdHandled])

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
          <div ref={listRef} style={{ position: 'relative', width: '100%', height: rowVirtualizer.getTotalSize() }}>
            {rowVirtualizer.getVirtualItems().map((item) => {
              const c = filtered[item.index]
              const group = statusGroup(statusById?.get(c.id) ?? 'new')
              const isOpen = open === c.id
              const isLast = item.index === filtered.length - 1
              const romaji = getRomaji(c.reading)
              const cat = c.category ? CATEGORY_BY_KEY[c.category] : undefined
              return (
                <div
                  key={c.id}
                  data-index={item.index}
                  ref={rowVirtualizer.measureElement}
                  className={`aw-item${isOpen ? ' open' : ''}${isLast ? ' last' : ''}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start - rowVirtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <div className="aw-row" onClick={() => setOpen(isOpen ? null : c.id)} role="button">
                    <span className="aw-num">{c.frequencyRank}</span>
                    <span className="aw-word">{c.headword}</span>
                    <span className="aw-reading">
                      {c.reading}
                      {c.ipa && <span className="aw-ipa"> {c.ipa}</span>}
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
                      <ReportButton card={c} uiLanguage={uiLanguage} className="aw-report" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
