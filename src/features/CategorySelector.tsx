import { useMemo } from 'react'
import type { VocabCard } from '../types'
import { CATEGORIES } from '../data/categories'

/**
 * カテゴリー別学習のセレクタ。コースに実在するカテゴリーだけをチップで並べ、
 * 選ぶと Study の盤面がそのカテゴリーの語だけになる（All＝全体）。
 * 進捗（words started 等）はコース全体のまま＝カテゴリーは「絞り込みレンズ」。
 */
export function CategorySelector({
  cards,
  selected,
  onSelect,
}: {
  cards: VocabCard[]
  selected: string | null
  onSelect: (key: string | null) => void
}) {
  // カテゴリー別の語数を数え、タクソノミー順に、存在するものだけ並べる。
  const available = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of cards) if (c.category) counts.set(c.category, (counts.get(c.category) ?? 0) + 1)
    return CATEGORIES.filter((cat) => (counts.get(cat.key) ?? 0) > 0).map((cat) => ({
      ...cat,
      count: counts.get(cat.key) ?? 0,
    }))
  }, [cards])

  if (available.length === 0) return null // カテゴリーデータが無ければ何も出さない

  return (
    <div className="cat-selector" role="tablist" aria-label="Study by category">
      <button
        type="button"
        className={`cat-chip${selected === null ? ' on' : ''}`}
        aria-selected={selected === null}
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {available.map((cat) => (
        <button
          key={cat.key}
          type="button"
          className={`cat-chip${selected === cat.key ? ' on' : ''}`}
          aria-selected={selected === cat.key}
          onClick={() => onSelect(cat.key)}
        >
          <span className="cat-emoji">{cat.emoji}</span>
          {cat.label}
          <span className="cat-count">{cat.count}</span>
        </button>
      ))}
    </div>
  )
}
