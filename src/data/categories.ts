/**
 * 語彙の意味カテゴリー（カテゴリー別学習のタクソノミー）。
 * 各語には categories.json（データと分離した overlay）で1つの key が付く。
 * ここは表示用のラベル・絵文字・並び順を定義する。'other'（未分類）はセレクタに出さない。
 */
export interface CategoryDef {
  key: string
  label: string
  emoji: string
}

export const CATEGORIES: CategoryDef[] = [
  { key: 'food', label: 'Food & Drink', emoji: '🍚' },
  { key: 'people', label: 'People & Family', emoji: '👪' },
  { key: 'body', label: 'Body & Health', emoji: '🧍' },
  { key: 'home', label: 'Home & Household', emoji: '🏠' },
  { key: 'clothing', label: 'Clothing', emoji: '👕' },
  { key: 'nature', label: 'Nature & Weather', emoji: '🌤️' },
  { key: 'animals', label: 'Animals & Plants', emoji: '🐾' },
  { key: 'places', label: 'Places & Buildings', emoji: '🏢' },
  { key: 'transport', label: 'Transport & Travel', emoji: '🚃' },
  { key: 'time', label: 'Time & Calendar', emoji: '🕐' },
  { key: 'numbers', label: 'Numbers & Counters', emoji: '🔢' },
  { key: 'school', label: 'School & Study', emoji: '🏫' },
  { key: 'work', label: 'Work & Money', emoji: '💼' },
  { key: 'shopping', label: 'Shopping & Services', emoji: '🛒' },
  { key: 'communication', label: 'Language & Communication', emoji: '💬' },
  { key: 'emotions', label: 'Feelings & Personality', emoji: '😊' },
  { key: 'activities', label: 'Hobbies & Activities', emoji: '⚽' },
  { key: 'society', label: 'Society & Ideas', emoji: '🏛️' },
]

export const CATEGORY_BY_KEY: Record<string, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c]),
)
