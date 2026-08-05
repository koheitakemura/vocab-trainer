import { useEffect, useMemo, useRef, useState } from 'react'
import type { CourseId, VocabCard } from '../../types'
import { wordMatchScore } from '../../text/wordMatch'
import { searchExtraPool, loadExtraPoolCard, type ExtraPoolIndexEntry } from '../../data/extraPool'
import { generateCard, type WordGenFailure } from '../../data/wordGen'
import { addCard } from '../../store/extraCards'
import { SearchIcon, SparkleIcon } from '../../ui/icons'
import { useStrings, type UiLanguage } from '../../text/i18n'

const MAX_RESULTS = 8

// Worker 側（worker/wordgen.ts の HEADWORD_RE）と同じ形式チェック。ここでの判定は
// 「AI生成ボタンを出すかどうか」のUX上の事前フィルタに過ぎず、実際の強制はサーバー側のみ
// （ここを緩めても安全性は損なわれない——単に無駄打ちのボタンを出さないための軽量チェック）。
// \p{L} は Unicode の「文字」全般（ラテン文字だけでなくひらがな・カタカナ・漢字も含む）——
// コースごとに学習言語が異なるため英字に限定しない（2026-08-02）。
const HEADWORD_LIKE_RE = /^[\p{L}][\p{L}\p{M}' -]{0,39}$/u

/**
 * タブ行に常設する検索ボックス（案④ Kohei 依頼）。現在のコース内だけを対象にする
 * （全コース横断は語彙データを全部読む必要があり、今回は対象外——docs/word-request-design.md §1）。
 * `cards` は既に追加した自分の語も含めた merged 配列（CourseScreen 側で組み立てる）——
 * 前回追加した語もローカル一致で即座に見つかる。
 *
 * 見つからないときは3段フォールバック（§2）：①ローカル一致 ②静的プール（在庫）から追加
 * ③AI生成（Phase 3・Worker 経由）。結果を選ぶ／追加すると onOpenWord が呼ばれ、
 * 単語一覧タブでその語が展開された状態になる。
 */
export function WordSearch({
  cards,
  uiLanguage,
  onOpenWord,
}: {
  cards: VocabCard[]
  uiLanguage: UiLanguage
  onOpenWord: (cardId: string) => void
}) {
  const t = useStrings(uiLanguage)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [poolResults, setPoolResults] = useState<ExtraPoolIndexEntry[]>([])
  const [poolPending, setPoolPending] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<WordGenFailure | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const courseId = cards[0]?.courseId as CourseId | undefined

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    const scored: { card: VocabCard; score: number }[] = []
    for (const card of cards) {
      const score = wordMatchScore(card.headword, card.reading, card.gloss, q)
      if (score !== null) scored.push({ card, score })
    }
    scored.sort((a, b) => a.score - b.score || a.card.frequencyRank - b.card.frequencyRank)
    return scored.slice(0, MAX_RESULTS).map((s) => s.card)
  }, [cards, query])

  // ローカルに1件もヒットしないときだけ、静的プール（未出荷の生成済みカード在庫）を探す。
  useEffect(() => {
    const q = query.trim()
    if (!courseId || !q || results.length > 0) {
      setPoolResults([])
      setPoolPending(false)
      return
    }
    let active = true
    setPoolPending(true)
    void searchExtraPool(courseId, q).then((r) => {
      if (!active) return
      setPoolResults(r)
      setPoolPending(false)
    })
    return () => {
      active = false
    }
  }, [courseId, query, results.length])

  // クエリが変わったら AI生成の状態をリセット（前回の失敗表示を引きずらない）
  useEffect(() => {
    setGenerateError(null)
  }, [query])

  // 外側クリックで結果を閉じる（フィルター入力等、他の場所への操作を妨げないため）
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const handleSelect = (cardId: string) => {
    onOpenWord(cardId)
    setQuery('')
    setOpen(false)
  }

  const handleAddFromPool = async (entry: ExtraPoolIndexEntry) => {
    if (!courseId || addingId) return
    setAddingId(entry.id)
    try {
      const card = await loadExtraPoolCard(courseId, entry)
      if (!card) return
      const added = await addCard(courseId, card)
      handleSelect(added.id)
    } finally {
      setAddingId(null)
    }
  }

  const handleGenerate = async () => {
    if (!courseId || generating) return
    const headword = query.trim()
    setGenerating(true)
    setGenerateError(null)
    try {
      const res = await generateCard(courseId, headword)
      if (res.ok) {
        const added = await addCard(courseId, res.card)
        handleSelect(added.id)
      } else {
        setGenerateError(res.reason)
      }
    } finally {
      setGenerating(false)
    }
  }

  const q = query.trim()
  const nothingFoundYet = results.length === 0 && !poolPending && poolResults.length === 0
  const canOfferGenerate = nothingFoundYet && HEADWORD_LIKE_RE.test(q)
  const showPlainEmpty = nothingFoundYet && !canOfferGenerate

  return (
    <div className="word-search" ref={rootRef}>
      {/* 虫めがねは入力欄の中に重ねる＝この枠（position:relative）が位置の基準。
          外側の .word-search はスマホで position:static にする（結果リストをタブの
          ツール行いっぱいに出すため）ので、アイコンの基準をここに分けて持たせている。 */}
      <span className="word-search-field">
        <SearchIcon className="word-search-icon" />
        <input
          type="search"
          className="word-search-input"
          placeholder={t.searchPlaceholder}
          aria-label={t.searchAria}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('')
              setOpen(false)
              e.currentTarget.blur()
            } else if (e.key === 'Enter' && results.length > 0) {
              handleSelect(results[0].id)
            }
          }}
        />
      </span>
      {open && q && (
        <div className="word-search-results" role="listbox">
          {results.map((c) => (
            <button key={c.id} type="button" className="word-search-item" role="option" onClick={() => handleSelect(c.id)}>
              <span className="word-search-word">{c.headword}</span>
              {c.reading && (
                <span className="word-search-reading">
                  {c.reading}
                  {c.ipa && <span className="word-search-ipa"> {c.ipa}</span>}
                </span>
              )}
              <span className="word-search-gloss">{c.gloss}</span>
            </button>
          ))}
          {poolResults.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="word-search-item word-search-item--add"
              role="option"
              disabled={addingId === entry.id}
              onClick={() => void handleAddFromPool(entry)}
            >
              <span className="word-search-add-icon" aria-hidden="true">
                +
              </span>
              <span className="word-search-word">{entry.headword}</span>
              {entry.reading && (
                <span className="word-search-reading">
                  {entry.reading}
                  {entry.ipa && <span className="word-search-ipa"> {entry.ipa}</span>}
                </span>
              )}
              <span className="word-search-gloss">{t.searchAddLabel}</span>
            </button>
          ))}
          {canOfferGenerate && !generateError && (
            <button
              type="button"
              className="word-search-item word-search-item--generate"
              role="option"
              disabled={generating}
              onClick={() => void handleGenerate()}
            >
              <SparkleIcon className="word-search-add-icon" />
              <span className="word-search-word">{q}</span>
              <span className="word-search-gloss">{generating ? t.searchGenerating : t.searchGenerateLabel}</span>
            </button>
          )}
          {generateError && (
            <div className="word-search-empty">
              {generateError === 'rate-limited'
                ? t.searchGenerateRateLimited
                : generateError === 'disabled'
                  ? t.searchGenerateDisabled
                  : t.searchGenerateFailed}
            </div>
          )}
          {showPlainEmpty && <div className="word-search-empty">{t.searchNoResults}</div>}
        </div>
      )}
    </div>
  )
}
