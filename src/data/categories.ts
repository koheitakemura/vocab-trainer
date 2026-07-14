/**
 * 語彙の意味・文法カテゴリー（カテゴリー別学習のタクソノミー）。
 * 各語には categories.json（データと分離した overlay）で1つの key が付く。
 * ここは表示用のラベル・絵文字・並び順・グループを定義する。'other'（真の未分類）はセレクタに出さない。
 */
export type CategoryGroup = 'topic' | 'grammar'

export interface CategoryDef {
  key: string
  label: string
  emoji: string
  group: CategoryGroup
}

export const CATEGORIES: CategoryDef[] = [
  // 意味（トピック）
  { key: 'food', label: 'Food & Drink', emoji: '🍚', group: 'topic' },
  { key: 'people', label: 'People & Family', emoji: '👪', group: 'topic' },
  { key: 'body', label: 'Body & Health', emoji: '🧍', group: 'topic' },
  { key: 'home', label: 'Home & Household', emoji: '🏠', group: 'topic' },
  { key: 'clothing', label: 'Clothing', emoji: '👕', group: 'topic' },
  { key: 'nature', label: 'Nature & Weather', emoji: '🌤️', group: 'topic' },
  { key: 'animals', label: 'Animals & Plants', emoji: '🐾', group: 'topic' },
  { key: 'places', label: 'Places & Buildings', emoji: '🏢', group: 'topic' },
  { key: 'transport', label: 'Transport & Travel', emoji: '🚃', group: 'topic' },
  { key: 'time', label: 'Time & Calendar', emoji: '🕐', group: 'topic' },
  { key: 'numbers', label: 'Numbers & Counters', emoji: '🔢', group: 'topic' },
  { key: 'school', label: 'School & Study', emoji: '🏫', group: 'topic' },
  { key: 'work', label: 'Work & Money', emoji: '💼', group: 'topic' },
  { key: 'shopping', label: 'Shopping & Services', emoji: '🛒', group: 'topic' },
  { key: 'communication', label: 'Language & Communication', emoji: '💬', group: 'topic' },
  { key: 'emotions', label: 'Feelings & Personality', emoji: '😊', group: 'topic' },
  { key: 'activities', label: 'Hobbies & Activities', emoji: '⚽', group: 'topic' },
  { key: 'society', label: 'Society & Ideas', emoji: '🏛️', group: 'topic' },
  // 文法・機能語
  { key: 'basic-verbs', label: 'Basic Verbs', emoji: '🎬', group: 'grammar' },
  { key: 'descriptors', label: 'Describing Words', emoji: '🎨', group: 'grammar' },
  { key: 'adverbs', label: 'Adverbs', emoji: '⚡', group: 'grammar' },
  { key: 'demonstratives', label: 'Demonstratives & Pronouns', emoji: '👉', group: 'grammar' },
  { key: 'question-words', label: 'Question Words', emoji: '❓', group: 'grammar' },
  { key: 'conjunctions', label: 'Connectors', emoji: '🔗', group: 'grammar' },
  { key: 'grammar', label: 'Grammar Words', emoji: '🧩', group: 'grammar' },
  { key: 'affixes', label: 'Prefixes & Suffixes', emoji: '🧷', group: 'grammar' },
]

export const CATEGORY_BY_KEY: Record<string, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c]),
)

export const GROUP_LABEL: Record<CategoryGroup, string> = {
  topic: 'Topics',
  grammar: 'Grammar & function words',
}
