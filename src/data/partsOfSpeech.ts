/**
 * 品詞別学習のタクソノミー。
 *
 * VocabCard.pos は**コースごとに表記体系がばらばら**なのが実情で、そのままでは選択肢にできない：
 *   - 日本語コース（ja-0-3k / ja-3-10k / ja-10-30k / ja-katakana）… 訳がタガログ語なので
 *     品詞ラベルもタガログ語（pangngalan＝名詞、pandiwa＝動詞、pang-uri＝形容詞…）
 *   - 英語コース（en-10-30k）・タガログ語コース（tl-0-2k）… 日本語ラベル（名詞・動詞…）
 *   - さらに「名詞（語根）」「形容詞・状態動詞」のような複合ラベルが尾を引く（tl-0-2k で29種）
 *
 * ここで**正規のキーへ畳んで**、表示は英語ラベルに統一する（categories.ts と同じ方針＝
 * 全コースが uiLanguage:'en' なのでラベルは英語で持つ）。
 * カードのデータは一切書き換えない——読むときに写像するだけの表示レイヤー。
 */
export type PosGroup = 'content' | 'function'

export interface PosDef {
  key: string
  label: string
  group: PosGroup
}

/**
 * 選択肢の並び順そのもの。内容語（名詞・動詞・形容詞・副詞）を先に、機能語を後ろに。
 *
 * 日本語の い/な/の 形容詞と する動詞を分けているのは Kohei 判断（2026-08-05）——
 * 活用がまるごと違うので、学習者にとっては別物として練習できたほうが実用的。
 * 英語・タガログ語コースにはこれらの値が存在しないので、その場合は自動的に出ない
 * （選択肢は「そのコースに実在する品詞」だけを数えて組み立てるため）。
 */
export const PARTS_OF_SPEECH: PosDef[] = [
  { key: 'noun', label: 'Nouns', group: 'content' },
  { key: 'verb', label: 'Verbs', group: 'content' },
  { key: 'verb-suru', label: 'Verbs (suru)', group: 'content' },
  { key: 'adj', label: 'Adjectives', group: 'content' },
  { key: 'adj-i', label: 'Adjectives (i)', group: 'content' },
  { key: 'adj-na', label: 'Adjectives (na)', group: 'content' },
  { key: 'adj-no', label: 'Adjectives (no)', group: 'content' },
  { key: 'adverb', label: 'Adverbs', group: 'content' },
  { key: 'pronoun', label: 'Pronouns', group: 'function' },
  { key: 'preposition', label: 'Prepositions', group: 'function' },
  { key: 'conjunction', label: 'Conjunctions', group: 'function' },
  { key: 'particle', label: 'Particles', group: 'function' },
  { key: 'numeral', label: 'Numerals', group: 'function' },
  { key: 'interjection', label: 'Interjections', group: 'function' },
  { key: 'question', label: 'Question words', group: 'function' },
  { key: 'determiner', label: 'Determiners', group: 'function' },
  { key: 'linker', label: 'Linkers', group: 'function' },
  { key: 'propernoun', label: 'Proper nouns', group: 'function' },
  { key: 'auxiliary', label: 'Auxiliaries', group: 'function' },
  { key: 'affix', label: 'Prefixes & suffixes', group: 'function' },
  { key: 'phrase', label: 'Set phrases', group: 'function' },
]

export const POS_BY_KEY: Record<string, PosDef> = Object.fromEntries(PARTS_OF_SPEECH.map((p) => [p.key, p]))

export const POS_GROUP_LABEL: Record<PosGroup, string> = {
  content: 'Words',
  function: 'Grammar & function words',
}

export const POS_GROUP_ORDER: PosGroup[] = ['content', 'function']

/**
 * データ上の生の pos 文字列 → 正規キー。
 * 全10コースの words-*.json を実測して出現した値を**全件**列挙してある（2026-08-05 時点）。
 * 新しいコース・新しい表記が増えたらここに足す。載っていない値は null になり、
 * 「絞り込みの対象外」として扱われる（All では従来どおり出る＝学習機会は失われない）。
 */
const RAW_TO_KEY: Record<string, string> = {
  // ── 日本語コース（タガログ語ラベル） ──
  pangngalan: 'noun',
  pandiwa: 'verb',
  'pandiwa (suru)': 'verb-suru',
  'pandiwa (kuru)': 'verb',
  'pang-uri': 'adj',
  'pang-uri (i)': 'adj-i',
  'pang-uri (na)': 'adj-na',
  'pang-uri (no)': 'adj-no',
  'pang-abay': 'adverb',
  panghalip: 'pronoun',
  pangatnig: 'conjunction',
  bilang: 'numeral',
  pambilang: 'numeral',
  pandamdam: 'interjection',
  parirala: 'phrase',
  kataga: 'particle',
  pantulong: 'auxiliary',
  unlapi: 'affix',
  hulapi: 'affix',

  // ── 英語コース・タガログ語コース（日本語ラベル） ──
  名詞: 'noun',
  動詞: 'verb',
  形容詞: 'adj',
  副詞: 'adverb',
  代名詞: 'pronoun',
  接続詞: 'conjunction',
  助詞: 'particle',
  数詞: 'numeral',
  感動詞: 'interjection',
  感嘆詞: 'interjection',
  前置詞: 'preposition',
  助動詞: 'auxiliary',
  固有名詞: 'propernoun',
  疑問詞: 'question',
  接頭辞: 'affix',
  限定詞: 'determiner',
  連結辞: 'linker',
  // 複合・希少ラベル（tl-0-2k の長い裾。主たる用法へ畳む）
  '名詞・形容詞': 'noun',
  '動詞（語根）': 'verb',
  '名詞（語根）': 'noun',
  '代名詞（指示）': 'pronoun',
  '副詞（疑問）': 'adverb',
  '形容詞（状態）': 'adj',
  '名詞（序数）': 'numeral',
  '数詞（序数）': 'numeral',
  '形容詞・状態動詞': 'adj',
  '動詞（直前完了相）': 'verb',
  '動詞（状態的）': 'verb',
  '名詞（形容詞的用法）': 'noun',
  '形容詞・副詞的': 'adj',
  '助詞（口語表現）': 'particle',

  // ── かな・漢字コース ──
  // 全語が同じ値なので絞り込みの意味が無い。写像しない＝セレクタが自動的に出ない。
}

/** カードの pos を正規キーへ。未知の表記・絞り込みに使えない値は null */
export function posKeyOf(pos: string | undefined): string | null {
  if (!pos) return null
  return RAW_TO_KEY[pos.trim()] ?? null
}

/**
 * セレクタに載せる下限語数。これ未満の品詞は選んでも学習セッションが組めず、
 * 選択肢だけが増えて読みにくくなる（実測では各コースに4〜20種の希少品詞がある）。
 */
export const POS_MIN_WORDS = 10

/**
 * 1つの品詞がこの割合を超えて占めるコースでは、絞り込みの意味が無いのでセレクタごと出さない。
 * ja-katakana は 830語中783語（94%）が名詞で、選んでも「ほぼ全体」にしかならない。
 * ja-10-30k は 86% が名詞だが、残り1,761語（形容詞778・動詞713・副詞222）に実用的な
 * まとまりがあるので出す（Kohei 了承済み）。
 */
export const POS_DOMINANCE_LIMIT = 0.9
