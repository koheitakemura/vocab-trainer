import type { RichPart, UIStrings } from './i18n'
import { fmtNum } from './format'

/**
 * 英語 UI 文言（コース C/D/E＝メンバー系の既定）。
 * 値は現状のコンポーネントに直書きされている英語と一字一句一致させてある
 *（次段の抽出作業が「この文字列 → このキー」で機械的に差し替えられるよう、正解の見本にする）。
 */
export const en: UIStrings = {
  // 起動・ロード
  bootError: 'Couldn’t load the course data. Check your connection and retry.',
  retry: 'Retry',
  loading: 'Loading…',
  loadingStats: 'Loading stats…',
  loadingGrowth: 'Loading growth…',

  // コース切替・ヘッダー landmark
  selectCourseAria: 'Select course',
  meterAria: 'progress',
  coursePreviewSuffix: ' (Preview)',

  // 端末内の表示名
  nameGreetingPrefix: (name) => `${name} — `,

  // ヘッダーのメーター
  wordsStarted: 'words started',
  meterEstTitle:
    "Estimated number of words you'd still recall right now, from the FSRS memory model. Distinct from 'words started', which counts every word you've touched. Conversation coverage is an approximate, corpus-based figure.",
  meterEst: (estKnown, progress) => {
    const base = `${fmtNum(estKnown)} words in long-term memory`
    if (progress.mode === 'coverage-pct') {
      return `${base} · ${progress.pct}% of ${progress.domain === 'written' ? 'written text' : 'everyday conversation'}`
    }
    return progress.depth != null ? `${base} · depth ${progress.depth}%` : base
  },
  meterHelpLabel: 'What does this mean?',
  meterHelpBody: [
    "This is how many words you'd actually recall right now — not just how many you've tapped. It's based on the FSRS memory model, the same system that decides when each word comes up for review.",
    'Right after you grade a word, it briefly counts toward this number no matter which button you tapped, because you clearly remember it in that moment. What differs is how fast that fades:',
    '• I know — fades slowly, stays counted for weeks',
    '• Fuzzy — fades within about a day',
    '• Studying — fades within hours, and the word comes back for review soon',
    'So this number naturally drops between study sessions as Fuzzy and Studying words fade, then rises again each time you review.',
  ],
  meterAddedCount: (n) => `+ ${n} of your own`,

  // タブ
  tabStudy: 'Study',
  tabAllWords: 'All words',
  tabStats: 'Stats',
  tabGrowth: 'Growth',
  startAnotherSession: 'Start another session',

  // フッター・バックアップ
  backup: 'Backup',
  restore: 'Restore',
  backupTitle: 'Download your progress as a JSON file',
  restoreTitle: 'Restore progress from a JSON file',
  unsaved: (n) => `${n} unsaved`,
  restoreComplete: (n) => `Restore complete — ${n} studied card(s).`,

  // 1回に並べるカードの枚数
  cardsPerSessionLabel: 'Cards per session',
  cardsPerSessionOption: (n) => `${n} cards`,

  // 採点音の設定
  tapSoundLabel: 'Tap sound',
  soundChime: 'Chime',
  soundPop: 'Pop',
  soundMarimba: 'Marimba',
  soundBell: 'Bell',
  soundOff: 'Off',

  // 採点ボタン／レベル
  gradeKnown: 'I know',
  gradeFuzzy: 'Fuzzy',
  gradeStudying: 'Studying',
  gradeKnownShort: 'Know',
  gradeFuzzyShort: 'Fuzzy',
  gradeStudyingShort: 'Study',
  mastered: 'Mastered',

  // 学習セッションの状態
  preparingSession: 'Preparing your session…',
  allCaughtUp: 'All caught up',
  nothingDue: 'Nothing is due right now.',
  resetProgressDemo: 'Reset progress (demo)',
  resetProgressConfirm:
    'This erases every learning record for this course (known words, review schedule, history). It cannot be undone. Continue?',

  staleEpochTitle: 'Your progress for this course no longer matches the words shown',
  staleEpochBody: (rows) =>
    `When this course's word data was rebuilt, the ordering changed, so ${rows} of your records may now be attached ` +
    'to different words. Words marked “known” may never come up again. Resetting starts this course over.',
  staleEpochReset: 'Reset this course',
  staleEpochKeep: 'Keep it as is',
  orphanNote: (n) => `${n} records point to words that are no longer in this course`,

  serverSyncedAgo: (label) => `Server sync: ${label} ago`,
  serverSyncNever: 'Not synced to server',
  serverSyncBlocked: '⚠ Sync paused (tap to review)',
  serverSyncBlockedConfirm:
    "You're about to overwrite the server record with data much smaller than what's saved there. " +
    'This warning usually means the data on this device was recently wiped. Overwrite anyway?',

  restoreAutoToast: (n) => `Restored your learning record from the server (${n} words)`,
  restoreOfferTitle: 'New learning record available on the server',
  restoreOfferBody: (n) => `Another device saved a record (${n} words). Loading it will replace what's on this device.`,
  restoreOfferEpochWarning:
    "This course's word IDs were rebuilt, so restoring may attach your record to different words.",
  restoreOfferAction: 'Load it',
  restoreOfferDismiss: 'Not now',
  restoreConfirmDialog: "This replaces this device's learning record with the server's copy. Continue?",
  restoreUndo: 'Undo',
  restoreUndoConfirm: 'This reverts to the state before the restore. Continue?',
  restoreUndoDone: (n) => `Reverted (${n} words)`,
  sessionComplete: 'Session complete',
  sessionSummary: (reviewed, again) => `${reviewed} reviews${again > 0 ? ` · ${again} marked “Studying”` : ''}`,

  // フォーカスシート
  tapToReveal: 'Tap to reveal',
  nextCard: 'Next card →',
  close: 'Close',

  // カードの誤り報告
  reportButton: 'Report an issue',
  reportSheetTitle: "What's wrong with this card?",
  reportReasonGloss: 'Translation is wrong',
  reportReasonReading: 'Reading/pronunciation is wrong',
  reportReasonPos: 'Part of speech is wrong',
  reportReasonExample: 'Example sentence is wrong',
  reportReasonInappropriate: "This word doesn't belong in this course",
  reportReasonOther: 'Other',
  reportNotePlaceholder: 'Add a note (optional)',
  reportSubmit: 'Send report',
  reportSubmitting: 'Sending…',
  reportCancel: 'Cancel',
  reportSent: 'Thanks — report sent.',
  reportQueued: "You're offline. We'll send this once you're back online.",
  reportFailed: (message) => `Couldn't send: ${message}`,

  // 未割当コースのプレビュー
  previewIntro: "This is a preview — take a look at a sample before you request access. You can't grade cards or save progress here.",
  previewCardCount: (shown) => `Showing the first ${shown} words as a sample`,
  previewRequestButton: 'Request access to this course',
  previewRequesting: 'Sending…',
  previewRequestSent: 'Request sent. An admin will review it.',
  previewAlreadyRequested: "You've already requested this course. An admin will review it.",
  previewAlreadyGranted: 'You already have access to this course — try switching to it again.',
  previewRequestFailed: (message) => `Couldn't send the request: ${message}`,

  // 語根表示
  rootLabel: 'Root',

  // 音声読み上げ
  playAudio: 'Play pronunciation',

  // 文脈クローズ
  clozeBadge: 'Fill in',

  // 単語検索（タブ行に常設）
  searchPlaceholder: 'Search this course…',
  searchAria: 'Search words in this course',
  searchNoResults: 'No matches',
  searchAddLabel: 'Add to this course',
  searchGenerateLabel: 'Generate with AI',
  searchGenerating: 'Generating…',
  searchGenerateRateLimited: "You've reached today's limit (20 words). Try again tomorrow.",
  searchGenerateDisabled: 'Word generation is temporarily unavailable.',
  searchGenerateFailed: "Couldn't generate this word. Try again later.",

  // 単語一覧のフィルター・状態
  statusNew: 'New',
  statusLearning: 'Learning',
  statusKnown: 'Known',
  filterWord: 'Word',
  filterReading: 'Reading',
  filterMeaning: 'Meaning',
  filterCategory: 'Category',
  filterStatus: 'Status',
  filterByWord: 'Filter by word',
  filterByReading: 'Filter by reading',
  filterByMeaning: 'Filter by meaning',
  filterByCategory: 'Filter by category',
  filterByStatus: 'Filter by status',
  noWordsMatch: 'No words match these filters.',
  matchingWords: 'matching words',

  // 統計タブ
  statsWordsStarted: 'Words started',
  statsInLongTermMemory: 'In long-term memory',
  statsEverydayConversation: 'Everyday conversation',
  statsWrittenText: 'Written text',
  statsCollocationDepth: 'Collocation depth',
  jlptVocabulary: 'JLPT vocabulary',
  jlptComplete: (level) => `🏅 ${level} vocabulary complete`,
  jlptDisclaimer: 'Level mapping is based on unofficial community JLPT word lists.',
  masteryByCategory: 'Mastery by category',
  jlptRingAria: (level, known, total) => `${level}: ${known} of ${total} words known`,

  // 成長タブ
  wordsKnown: 'Words known',
  dayStreak: 'Day streak',
  daysStudied: 'Days studied',
  growthLegendStarted: 'Started',
  growthLegendKnown: 'Known',
  bestStreak: (days) => `Best streak · ${days} days`,
  growthCaption:
    'The green area is what you know; the gap above it is what you’re still learning. Keep showing up and watch it climb.',
  growthEmptyStartTitle: 'Your growth curve starts here',
  growthEmptyStartSub: 'Study a few words and come back — this page fills in a little more every day.',
  growthEmptyOnWayTitle: 'You’re on your way',
  growthEmptyOnWaySub:
    'Come back after another day of studying to watch your curve start to climb. Every day you show up adds a point.',
  growthChartAria: (started, known) => `Vocabulary growth: ${fmtNum(started)} words started, ${fmtNum(known)} known`,

  // 週次ふりかえりカード
  weeklyThisWeek: 'This week',
  weeklyLastWeek: 'Last week',
  weeklyLine: (activeDays, reviews, newWords): RichPart[] => [
    { text: 'Studied ' },
    { text: `${activeDays}`, bold: true },
    { text: ` ${activeDays === 1 ? 'day' : 'days'} · ` },
    { text: `${reviews}`, bold: true },
    { text: ' reviews · ' },
    { text: `${newWords}`, bold: true },
    { text: ' new words' },
  ],
  weeklyUp: (up) => ` ▲ +${up} vs previous week`,
  weeklyBackup: 'Back up your progress (takes 30s)',

  // 節目チップ／全画面演出
  courseComplete: (total) => `All ${fmtNum(total)} words started — course complete 🎉`,
  nextMilestone: (next, remaining, coveragePct): RichPart[] => [
    { text: 'Next: ' },
    { text: fmtNum(next), bold: true },
    { text: ` · ${remaining} to go · unlocks ${coveragePct}% of everyday conversation` },
  ],
  milestoneBig: (milestone) => `${fmtNum(milestone)} words started 🎉`,
  milestoneSub: (coveragePct) => `You now recognize ${coveragePct}% of everyday conversation`,
  milestoneNext: (next) => `Next stop: ${fmtNum(next)}`,

  // カテゴリー選択
  allCategories: 'All categories',
  studyByCategory: 'Study by category',

  // クレジット
  creditsButton: 'Credits',
  dataCredits: 'Data credits',
  sourceLicenseLabel: 'License:',
  noSourcesYet: 'No data source information is available for this course yet.',
}
