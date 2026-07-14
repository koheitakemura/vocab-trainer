import { useMemo } from 'react'
import type { VocabCard } from '../types'
import { CATEGORIES, GROUP_LABEL, type CategoryGroup } from '../data/categories'

/**
 * カテゴリー別学習のプルダウン。コースに実在するカテゴリーだけを Topics / Grammar に分けて並べ、
 * 選ぶと Study の盤面がそのカテゴリーの語だけになる（All＝全体）。
 * タブ行に置く1行のセレクトなので、カード表示領域を占有しない。
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
  // カテゴリー別の語数を数え、タクソノミー順に、存在するものだけグループごとに並べる。
  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of cards) if (c.category) counts.set(c.category, (counts.get(c.category) ?? 0) + 1)
    const byGroup: Record<CategoryGroup, { key: string; label: string; emoji: string; count: number }[]> = {
      topic: [],
      grammar: [],
    }
    for (const cat of CATEGORIES) {
      const n = counts.get(cat.key) ?? 0
      if (n > 0) byGroup[cat.group].push({ key: cat.key, label: cat.label, emoji: cat.emoji, count: n })
    }
    return byGroup
  }, [cards])

  if (groups.topic.length === 0 && groups.grammar.length === 0) return null

  return (
    <label className="cat-select-wrap" title="Study by category">
      <span className="cat-select-icon" aria-hidden="true">
        ▤
      </span>
      <select
        className={`cat-select${selected ? ' active' : ''}`}
        aria-label="Study by category"
        value={selected ?? ''}
        onChange={(e) => onSelect(e.target.value || null)}
      >
        <option value="">All categories</option>
        {(['topic', 'grammar'] as CategoryGroup[]).map((g) =>
          groups[g].length > 0 ? (
            <optgroup key={g} label={GROUP_LABEL[g]}>
              {groups[g].map((c) => (
                <option key={c.key} value={c.key}>
                  {c.emoji} {c.label} ({c.count})
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </select>
    </label>
  )
}
