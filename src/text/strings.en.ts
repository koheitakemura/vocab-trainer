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

  // 採点ボタン／レベル
  gradeKnown: 'I know',
  gradeFuzzy: 'Fuzzy',
  gradeStudying: 'Studying',
  mastered: 'Mastered',

  // 学習セッションの状態
  preparingSession: 'Preparing your session…',
  allCaughtUp: 'All caught up',
  nothingDue: 'Nothing is due right now.',
  resetProgressDemo: 'Reset progress (demo)',
  sessionComplete: 'Session complete',
  sessionSummary: (reviewed, again) => `${reviewed} reviews${again > 0 ? ` · ${again} marked “Studying”` : ''}`,

  // フォーカスシート
  tapToReveal: 'Tap to reveal',
  nextCard: 'Next card →',
  close: 'Close',

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
