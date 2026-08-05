import { useMemo } from 'react'
import type { VocabCard } from '../types'
import {
  PARTS_OF_SPEECH,
  POS_DOMINANCE_LIMIT,
  POS_GROUP_LABEL,
  POS_GROUP_ORDER,
  POS_MIN_WORDS,
  posKeyOf,
  type PosGroup,
} from '../data/partsOfSpeech'
import { useStrings, type UiLanguage } from '../text/i18n'

/**
 * 品詞別学習のプルダウン。CategorySelector と対になる「絞り込みレンズ」で、
 * 選ぶと Study の盤面がその品詞の語だけになる（All＝全体）。
 * 進捗（words started・メーター・目盛り）はコース全体のまま＝ここでは一切触らない。
 *
 * コースに実在する品詞だけを数えて出す。出す価値が無いコースでは自分を消す：
 *   - 実用的な選択肢（POS_MIN_WORDS 語以上）が2つ未満
 *   - 1つの品詞が POS_DOMINANCE_LIMIT を超えて占める（ja-katakana は94%が名詞）
 * かな・漢字コースは pos が単一値で正規キーへ写像していないため、自動的に0件になり出ない。
 */
export function PosSelector({
  cards,
  selected,
  onSelect,
  uiLanguage,
}: {
  cards: VocabCard[]
  selected: string | null
  onSelect: (key: string | null) => void
  uiLanguage: UiLanguage
}) {
  const t = useStrings(uiLanguage)
  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    let mapped = 0
    for (const c of cards) {
      const key = posKeyOf(c.pos)
      if (!key) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
      mapped++
    }
    const byGroup: Record<PosGroup, { key: string; label: string; count: number }[]> = { content: [], function: [] }
    let shown = 0
    let top = 0
    for (const p of PARTS_OF_SPEECH) {
      const n = counts.get(p.key) ?? 0
      if (n > top) top = n
      if (n >= POS_MIN_WORDS) {
        byGroup[p.group].push({ key: p.key, label: p.label, count: n })
        shown++
      }
    }
    // 選択肢が1つしか立たない／1品詞が大半を占めるコースでは絞り込みの意味が無い
    const worthShowing = shown >= 2 && mapped > 0 && top / mapped <= POS_DOMINANCE_LIMIT
    return { byGroup, worthShowing }
  }, [cards])

  if (!groups.worthShowing) return null

  return (
    <label className="cat-select-wrap" title={t.studyByPos}>
      <span className="cat-select-icon" aria-hidden="true">
        ⌇
      </span>
      <select
        className={`cat-select${selected ? ' active' : ''}`}
        aria-label={t.studyByPos}
        value={selected ?? ''}
        onChange={(e) => onSelect(e.target.value || null)}
      >
        <option value="">{t.allPartsOfSpeech}</option>
        {POS_GROUP_ORDER.map((g) =>
          groups.byGroup[g].length > 0 ? (
            <optgroup key={g} label={POS_GROUP_LABEL[g]}>
              {groups.byGroup[g].map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label} ({p.count})
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </select>
    </label>
  )
}
