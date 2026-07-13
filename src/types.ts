import type { Card as FsrsCard } from 'ts-fsrs'

/** コース識別子（1エンジン × 複数コース。MVP はまず ja-0-3k を実装） */
export type CourseId =
  | 'ja-0-3k' // C: 日本語 0→3k（メンバー・レール型）
  | 'ja-3-10k' // D: 日本語 3k→10k（cloze 主軸）
  | 'ja-10-30k' // E: 日本語 10k→30k（較正＋マイニング）
  | 'en-10-30k' // A: 英語 10k→30k（Kohei）
  | 'tl-0-3k' // B: タガログ語 0→3k（Kohei）

export type CourseType = 'rail' | 'cloze' | 'calibrate-mine'

export interface Course {
  id: CourseId
  title: string
  /** 学習する言語（表示ラベル） */
  learningLanguage: string
  /** 訳語の言語 */
  glossLanguage: string
  /** UI 言語（コースごと。メンバー系=en / Kohei 系=ja） */
  uiLanguage: 'ja' | 'en'
  type: CourseType
  band: { from: number; to: number }
}

export interface Example {
  text: string
  translation: string
}

/**
 * 語彙カードの中身（コース非依存の語彙データ）。
 * mock も real も同じ型 = 機能追加は「データソースの差し替え」だけで済ませる。
 */
export interface VocabCard {
  id: string
  courseId: CourseId
  /** 見出し語（漢字・かな・原語） */
  headword: string
  /** 発音表記（日本語=かな読み／英語=IPA発音記号／タガログ語=アクセント位置付き表記） */
  reading?: string
  /** 訳語（グロス） */
  gloss: string
  /** 品詞 */
  pos: string
  examples: Example[]
  /** 頻度ランク（小さいほど高頻度＝先に出す） */
  frequencyRank: number
  jlptLevel?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
}

/** jpdb の10状態モデルを簡約したユーザー単位の語の状態 */
export type WordStatus =
  | 'new' // 未着手
  | 'learning' // 学習中
  | 'known' // 習得（安定）
  | 'burned' // 卒業（レビューキューから除外）
  | 'suspended' // 一時停止（leech 等）
  | 'blacklisted' // 対象外

/**
 * 進捗レコード（IndexedDB にローカル保存＝端末内）。
 * サーバー同期はせず、手動 JSON エクスポート/インポートでバックアップ・端末移行する。
 */
export interface WordProgress {
  cardId: string
  courseId: CourseId
  status: WordStatus
  /** ts-fsrs の Card（due / stability / difficulty / state / reps ...） */
  fsrs: FsrsCard
  reviewedCount: number
  /** 最終レビュー日時（ISO 文字列） */
  lastReviewedAt?: string
}
