import type { RichPart, UIStrings } from './i18n'
import { fmtNum } from './format'

/**
 * 日本語 UI 文言（UI が日本語のコース A＝英語 10k→30k・B＝タガログ語 0→3k 向け）。
 * en と同じキー集合・同じ引数で自然な日本語訳を用意する（数値の差し込みは各言語で自然に組む）。
 */
export const ja: UIStrings = {
  // 起動・ロード
  bootError: 'コースデータを読み込めませんでした。接続を確認して再試行してください。',
  retry: '再試行',
  loading: '読み込み中…',
  loadingStats: '統計を読み込み中…',
  loadingGrowth: '成長データを読み込み中…',

  // コース切替・ヘッダー landmark
  selectCourseAria: 'コースを選択',
  meterAria: '進捗',

  // ヘッダーのメーター
  wordsStarted: '開始した語数',
  meterEstTitle:
    'FSRS の記憶モデルに基づく、今この瞬間に思い出せる推定語数です。触れた語をすべて数える「開始した語数」とは別物です。会話カバー率はコーパスに基づく概算値です。',
  meterEst: (estKnown, progress) => {
    const base = `長期記憶に ${fmtNum(estKnown)} 語`
    if (progress.mode === 'coverage-pct') {
      return `${base} · ${progress.domain === 'written' ? '書き言葉' : '日常会話'}の ${progress.pct}%`
    }
    return progress.depth != null ? `${base} · 深度 ${progress.depth}%` : base
  },

  // タブ
  tabStudy: '学習',
  tabAllWords: '単語一覧',
  tabStats: '統計',
  tabGrowth: '成長',
  startAnotherSession: 'もう一度学習する',

  // フッター・バックアップ
  backup: 'バックアップ',
  restore: '復元',
  backupTitle: '進捗を JSON ファイルとして保存します',
  restoreTitle: 'JSON ファイルから進捗を復元します',
  unsaved: (n) => `未保存 ${n} 件`,
  restoreComplete: (n) => `復元しました — 学習済みカード ${n} 件。`,

  // 採点ボタン／レベル
  gradeKnown: '知ってる',
  gradeFuzzy: 'あいまい',
  gradeStudying: '学習中',
  mastered: '習得済み',

  // 学習セッションの状態
  preparingSession: 'セッションを準備中…',
  allCaughtUp: 'すべて完了',
  nothingDue: '今すぐ復習する語はありません。',
  resetProgressDemo: '進捗をリセット（デモ）',
  sessionComplete: 'セッション完了',
  sessionSummary: (reviewed, again) => `${reviewed} 回復習${again > 0 ? ` · ${again} 語を「学習中」に` : ''}`,

  // フォーカスシート
  tapToReveal: 'タップして表示',
  nextCard: '次のカード →',
  close: '閉じる',

  // 単語一覧のフィルター・状態
  statusNew: '未学習',
  statusLearning: '学習中',
  statusKnown: '既知',
  filterWord: '単語',
  filterReading: '読み',
  filterMeaning: '意味',
  filterCategory: 'カテゴリー',
  filterStatus: '状態',
  filterByWord: '単語で絞り込み',
  filterByReading: '読みで絞り込み',
  filterByMeaning: '意味で絞り込み',
  filterByCategory: 'カテゴリーで絞り込み',
  filterByStatus: '状態で絞り込み',
  noWordsMatch: '条件に一致する単語がありません。',
  matchingWords: '一致した単語',

  // 統計タブ
  statsWordsStarted: '開始した語数',
  statsInLongTermMemory: '長期記憶',
  statsEverydayConversation: '日常会話',
  statsWrittenText: '書き言葉',
  statsCollocationDepth: 'コロケーション深度',
  jlptVocabulary: 'JLPT 語彙',
  jlptComplete: (level) => `🏅 ${level} 語彙コンプリート`,
  jlptDisclaimer: 'レベル対応は非公式のコミュニティ JLPT 単語リストに基づきます。',
  masteryByCategory: 'カテゴリー別の習得率',
  jlptRingAria: (level, known, total) => `${level}: ${total} 語中 ${known} 語 習得`,

  // 成長タブ
  wordsKnown: '覚えた語',
  dayStreak: '連続日数',
  daysStudied: '学習日数',
  growthLegendStarted: '開始',
  growthLegendKnown: '既知',
  bestStreak: (days) => `最長連続 · ${days} 日`,
  growthCaption: '緑の部分が覚えた語、その上の余白がまだ学習中の語です。続けるほど伸びていきます。',
  growthEmptyStartTitle: '成長曲線はここから始まります',
  growthEmptyStartSub: '何語か学習してから戻ってきてください——このページは毎日少しずつ埋まっていきます。',
  growthEmptyOnWayTitle: '順調です',
  growthEmptyOnWaySub: 'もう1日学習してから戻ると、曲線が伸び始めます。続けた日ごとに点が増えます。',
  growthChartAria: (started, known) => `語彙の成長: 開始 ${fmtNum(started)} 語・既知 ${fmtNum(known)} 語`,

  // 週次ふりかえりカード
  weeklyThisWeek: '今週',
  weeklyLastWeek: '先週',
  weeklyLine: (activeDays, reviews, newWords): RichPart[] => [
    { text: `${activeDays}`, bold: true },
    { text: ' 日学習 · ' },
    { text: `${reviews}`, bold: true },
    { text: ' 回復習 · ' },
    { text: `${newWords}`, bold: true },
    { text: ' 語の新出' },
  ],
  weeklyUp: (up) => ` ▲ 前週比 +${up}`,
  weeklyBackup: '進捗をバックアップ（30秒）',

  // 節目チップ／全画面演出
  courseComplete: (total) => `全 ${fmtNum(total)} 語を開始 — コース完了 🎉`,
  nextMilestone: (next, remaining, coveragePct): RichPart[] => [
    { text: '次: ' },
    { text: fmtNum(next), bold: true },
    { text: ` · あと ${remaining} 語 · 日常会話の ${coveragePct}% を解放` },
  ],
  milestoneBig: (milestone) => `${fmtNum(milestone)} 語を開始 🎉`,
  milestoneSub: (coveragePct) => `日常会話の ${coveragePct}% を認識できるようになりました`,
  milestoneNext: (next) => `次の目標: ${fmtNum(next)}`,

  // カテゴリー選択
  allCategories: 'すべてのカテゴリー',
  studyByCategory: 'カテゴリー別に学習',

  // クレジット
  creditsButton: 'クレジット',
  dataCredits: 'データクレジット',
  sourceLicenseLabel: 'ライセンス:',
  noSourcesYet: 'このコースの出典情報はまだ登録されていません。',
}
