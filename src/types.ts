import type { Card as FsrsCard } from 'ts-fsrs'
import type { ReviewGrade } from './srs/scheduler'

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
 * v2 以降、未着手（status 'new'）の語は行を持たない＝「行が無い ＝ new」。
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
  /** 直近の採点（内訳表示用）。この機能追加前の行には無い（次回レビューで自然に付く） */
  lastGrade?: ReviewGrade
}

/**
 * コース別の増分集計（1コース1行）。ヘッダーのメーターが読む。
 * recordReview が採点と同一トランザクションで更新する＝progress 全行スキャンを毎採点で
 * 走らせない（3万語スケールでも採点コストが一定）。progress から常に再導出できる派生データ。
 */
export interface CourseSummary {
  courseId: CourseId
  /** 一度でも採点した語数（words started） */
  introduced: number
  /** 直近の採点（lastGrade）ごとの語数内訳 */
  byGrade: Record<ReviewGrade, number>
}

/**
 * 日次の学習ログ（1コース×1日＝1行の追記型）。
 * 将来のデイリーゴール・ストリーク・成長曲線・週次ふりかえりの共通基盤。
 * 記録開始の遅れは曲線の欠損として永久に残るため、書き込み層だけ先行搭載している。
 */
export interface DailyStat {
  courseId: CourseId
  /** ローカル日付 YYYY-MM-DD */
  date: string
  /** この日の採点回数（再採点含む） */
  reviews: number
  /** この日に初採点した語数 */
  newStarted: number
  /** Fuzzy/Studying → I know へ上げた前進の回数 */
  promotions: number
  /** 期限が来ていた復習カードをこの日はじめて採点した回数（実測定着率の分母） */
  dueReviews: number
  /** ↑のうち Studying（again）だった回数（実測定着率の失敗数） */
  dueAgain: number
  /** この日の終了時点の I know 語数スナップショット（成長曲線用） */
  knownTotal: number
}

/** 端末ローカルの小さな設定・状態の置き場（key-value。将来のゴール設定・ストリーク等用） */
export interface MetaRow {
  key: string
  value: unknown
}
