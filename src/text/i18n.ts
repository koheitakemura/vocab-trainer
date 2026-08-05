import type { Course } from '../types'
import type { CourseProgress } from '../data/coverage'
import { en } from './strings.en'
import { ja } from './strings.ja'

/**
 * UI 言語（コースごと。types.ts の Course.uiLanguage と同一の集合）。
 * ここを一次ソースにせず Course から導出して両者のズレを型で防ぐ。
 */
export type UiLanguage = Course['uiLanguage']

/**
 * 文中の一部（数値）だけを太字にする2箇所（WeeklyCard.weeklyLine・MilestoneChip.nextMilestone）専用の
 * リッチテキスト表現。プレーン文字列だと呼び出し側で <strong> の位置を言語ごとに指定できないため、
 * 「太字にする/しない」を持つ断片の配列で返す（呼び出し側が bold なら <strong>、そうでなければそのまま描画）。
 */
export interface RichPart {
  text: string
  bold?: boolean
}

/**
 * UI チロム（ボタン・ラベル・見出し）の文言テーブルの型。
 *
 * 設計方針（過剰に汎用化しない）:
 * - 対象は en / ja の2言語だけ（2026-07-30時点で全コースUI=en。ja は将来日本語UIコースが
 *   増えたときのために型・文言テーブルとも保持）。
 * - フラット（ネストしない）。キーは画面の役割で命名し、機能追加＝キー追加で済ませる。
 * - 語彙データ本体（見出し語・訳語・例文）は対象外。あくまで画面の固定文言のみ。
 * - 静的なラベルは string。数値等を差し込む文言だけ関数にする——英語と日本語で語順・
 *   複数形（英語 day/days ↔ 日本語は無変化）が違うため、テンプレート＋置換より各言語が
 *   自然に組み立てられる関数のほうが破綻しない。en/ja 両方が本 interface を実装するので、
 *   キー漏れ・引数の食い違いはコンパイル時に落ちる。
 *
 * 適用対象外（意図的に i18n テーブルへ入れない）:
 * - Credits.tsx のライセンス帰属本文（EDRDG / CC BY 継承の表示義務。原文の英語表記を
 *   そのまま出す義務があり翻訳してはいけない）。ボタン等のチロムだけ本テーブルで扱う。
 * - JLPT レベル記号（N5..N1）・カテゴリー/グループ名（data/categories.ts のコンテンツ側）。
 */
export interface UIStrings {
  // ── 起動・ロード（App.tsx / 各タブのローディング）
  bootError: string
  retry: string
  loading: string
  loadingStats: string
  loadingGrowth: string

  // ── コース切替・ヘッダー landmark（CourseScreen.tsx・CoursePicker.tsx）
  selectCourseAria: string
  meterAria: string
  /** 未割当コースの表示名に付ける接尾辞（select の見出し・各 option の両方に付く。例:" (Preview)"） */
  coursePreviewSuffix: string

  // ── 端末内の表示名（CourseScreen.tsx。アカウント登録ではなく、同じ端末で使う人を
  //    区別するためのローカル専用ラベル。登録・変更は管理者画面からのみ行う——ここは
  //    表示のみなので文言は挨拶プレフィックスだけで足りる）
  /** コーチ・メッセージの先頭に付ける挨拶（名前未設定なら呼ばれない） */
  nameGreetingPrefix: (name: string) => string

  // ── ヘッダーのメーター（CourseScreen.tsx）
  wordsStarted: string
  meterEstTitle: string
  /** progress は courseProgress() の戻り値そのまま渡す（帯によって被覆率%/語数+深度で文が変わるため） */
  meterEst: (estKnown: number, progress: CourseProgress) => string
  /** 「？」ツールチップのラベル（aria-label）と本文。本文は改行区切りの複数段落 */
  meterHelpLabel: string
  meterHelpBody: string[]
  /** 検索して自分で追加した語の数（分母には混ぜない・メーター横に別枠で添える） */
  meterAddedCount: (n: number) => string

  // ── タブ（CourseScreen.tsx）
  tabStudy: string
  tabAllWords: string
  tabStats: string
  tabGrowth: string
  startAnotherSession: string

  // ── フッター・バックアップ（CourseScreen.tsx）※先頭のアイコン字形は装飾で JSX 側に残す
  backup: string
  restore: string
  backupTitle: string
  restoreTitle: string
  unsaved: (n: number) => string
  restoreComplete: (n: number) => string

  // ── 1回に並べるカードの枚数（BoardSizeSettings.tsx）
  cardsPerSessionLabel: string
  /** プルダウンの各選択肢。枚数の数え方が言語で違うので関数にしている */
  cardsPerSessionOption: (n: number) => string

  // ── 採点音の設定（SoundSettings.tsx）
  tapSoundLabel: string
  soundChime: string
  soundPop: string
  soundMarimba: string
  soundBell: string
  soundOff: string

  // ── 採点ボタン／レベル（StudyGrid.tsx・FocusSheet.tsx・MeterBreakdown.tsx）
  gradeKnown: string
  gradeFuzzy: string
  gradeStudying: string
  /**
   * 盤面タイルの採点ボタン用の短縮ラベル（スマホ2列のときだけ CSS で出し分ける）。
   * 2列だとボタン1つの実寸が 46px しかなく、通常ラベル（"Studying" は 57px 必要）が
   * 「Stud…」と省略され、どのボタンか読めなくなるため。フォーカスシート・凡例など
   * 幅に余裕がある場所は通常ラベルのまま。
   */
  gradeKnownShort: string
  gradeFuzzyShort: string
  gradeStudyingShort: string
  mastered: string

  // ── 学習セッションの状態（StudyGrid.tsx）
  preparingSession: string
  allCaughtUp: string
  nothingDue: string
  resetProgressDemo: string
  resetProgressConfirm: string

  // ── 進捗の健全性バナー（CourseScreen.tsx）
  staleEpochTitle: string
  staleEpochBody: (rows: number) => string
  staleEpochReset: string
  staleEpochKeep: string
  orphanNote: (n: number) => string

  // ── サーバー同期の状態表示（CourseScreen.tsx フッター）
  serverSyncedAgo: (label: string) => string
  serverSyncNever: string
  serverSyncBlocked: string
  serverSyncBlockedConfirm: string
  restoreAutoToast: (n: number) => string
  restoreOfferTitle: string
  restoreOfferBody: (n: number) => string
  restoreOfferEpochWarning: string
  restoreOfferAction: string
  restoreOfferDismiss: string
  restoreConfirmDialog: string
  restoreUndo: string
  restoreUndoConfirm: string
  restoreUndoDone: (n: number) => string
  sessionComplete: string
  sessionSummary: (reviewed: number, again: number) => string

  // ── フォーカスシート（FocusSheet.tsx）
  tapToReveal: string
  nextCard: string
  close: string

  // ── カードの誤り報告（ReportButton.tsx。FocusSheet の裏面・AllWords の展開行に置く）
  reportButton: string
  reportSheetTitle: string
  reportReasonGloss: string
  reportReasonReading: string
  reportReasonPos: string
  reportReasonExample: string
  reportReasonInappropriate: string
  reportReasonOther: string
  reportNotePlaceholder: string
  reportSubmit: string
  reportSubmitting: string
  reportCancel: string
  reportSent: string
  reportQueued: string
  reportFailed: (message: string) => string

  // ── 未割当コースのプレビュー（CoursePreviewScreen.tsx）。採点・保存は一切できない
  //    読み取り専用の画面——先頭カードのサンプルを見せて「利用したい」を送るためだけの UI。
  previewIntro: string
  /** 「先頭 shown 件のサンプル」の件数表示。プレビューは先頭帯しか取得しないため、
   *  コース全体の正確な語数は分からない（分かるふりをしない） */
  previewCardCount: (shown: number) => string
  previewRequestButton: string
  previewRequesting: string
  /** リクエストを新規に受け付けた */
  previewRequestSent: string
  /** 直前に自分が送った pending なリクエストが既にある */
  previewAlreadyRequested: string
  /** クライアントの割当キャッシュが古いだけで、実はもう使える状態だった */
  previewAlreadyGranted: string
  previewRequestFailed: (message: string) => string

  // ── 語根表示（StudyGrid.tsx・FocusSheet.tsx。タガログ語コース専用・VocabCard.root がある語だけ）
  rootLabel: string

  // ── 音声読み上げ（StudyGrid.tsx・FocusSheet.tsx。フレーズコース専用・端末にタガログ語音声がある場合だけ）
  playAudio: string

  // ── 文脈クローズ（StudyGrid.tsx・FocusSheet.tsx。cloze/較正コースの昇格カードにだけ出る小ラベル）
  clozeBadge: string

  // ── 単語検索（WordSearch.tsx。タブ行に常設。現在のコース内を横断検索）
  searchPlaceholder: string
  searchAria: string
  searchNoResults: string
  /** 見つからなかった語を静的プールから追加するボタン（見出し語自体は隣の word-search-word に出るので繰り返さない） */
  searchAddLabel: string
  /** 静的プールにも無い語をAI生成するボタン（Phase 3・同上、見出し語は繰り返さない） */
  searchGenerateLabel: string
  searchGenerating: string
  searchGenerateRateLimited: string
  searchGenerateDisabled: string
  searchGenerateFailed: string

  // ── 単語一覧のフィルター・状態（AllWords.tsx）
  statusNew: string
  statusLearning: string
  statusKnown: string
  filterWord: string
  filterReading: string
  filterMeaning: string
  filterCategory: string
  filterStatus: string
  filterByWord: string
  filterByReading: string
  filterByMeaning: string
  filterByCategory: string
  filterByStatus: string
  noWordsMatch: string
  matchingWords: string

  // ── 統計タブ（StatsPanel.tsx）
  statsWordsStarted: string
  statsInLongTermMemory: string
  statsEverydayConversation: string
  /** cloze(3k-10k) 帯の被覆率ラベル（1.5.4 の書き言葉ドメイン） */
  statsWrittenText: string
  /** calibrate-mine(10k-30k) 帯の深度ラベル（1.5.4 の語数+深度） */
  statsCollocationDepth: string
  jlptVocabulary: string
  jlptComplete: (level: string) => string
  jlptDisclaimer: string
  masteryByCategory: string
  jlptRingAria: (level: string, known: number, total: number) => string

  // ── 成長タブ（GrowthView.tsx・GrowthChart.tsx）
  wordsKnown: string
  dayStreak: string
  daysStudied: string
  growthLegendStarted: string
  growthLegendKnown: string
  bestStreak: (days: number) => string
  growthCaption: string
  growthEmptyStartTitle: string
  growthEmptyStartSub: string
  growthEmptyOnWayTitle: string
  growthEmptyOnWaySub: string
  /** SVG チャートの role="img" aria-label */
  growthChartAria: (started: number, known: number) => string

  // ── 週次ふりかえりカード（WeeklyCard.tsx）
  weeklyThisWeek: string
  weeklyLastWeek: string
  weeklyLine: (activeDays: number, reviews: number, newWords: number) => RichPart[]
  weeklyUp: (up: number) => string
  weeklyBackup: string

  // ── 節目チップ／全画面演出（MilestoneChip.tsx・MilestoneOverlay.tsx）
  courseComplete: (total: number) => string
  nextMilestone: (next: number, remaining: number, coveragePct: number) => RichPart[]
  milestoneBig: (milestone: number) => string
  milestoneSub: (coveragePct: number) => string
  milestoneNext: (next: number) => string

  // ── カテゴリー選択（CategorySelector.tsx）
  allCategories: string
  studyByCategory: string

  // ── クレジット（Credits.tsx）※チロムのみ。ライセンス本文（出典名・note・license 文字列自体）は翻訳しない
  creditsButton: string
  dataCredits: string
  /** 出典1件ごとの「License: 」ラベル（値の CC BY 等は course.sources から来る原文のまま） */
  sourceLicenseLabel: string
  /** course.sources が空のときの案内文 */
  noSourcesYet: string
}

/**
 * uiLanguage に対応する文言セットを返す。React Context は使わない——CourseScreen 等は
 * course.uiLanguage を props で持っているので、素直に呼び出すだけで足りる。
 * 返り値は言語ごとの単一シングルトンなので参照が安定（useMemo の依存に入れても安全）。
 */
export function getStrings(uiLanguage: UiLanguage): UIStrings {
  return uiLanguage === 'ja' ? ja : en
}

/** コンポーネントからの呼び出しを読みやすくする別名（状態を持たない＝実体は getStrings）。 */
export const useStrings = getStrings
