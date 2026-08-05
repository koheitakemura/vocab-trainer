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
  coursePreviewSuffix: '（プレビュー）',

  // 端末内の表示名
  nameGreetingPrefix: (name) => `${name}さん、`,

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
  meterHelpLabel: 'この数字について',
  meterHelpBody: [
    'これは「今この瞬間、実際に思い出せる語数」です。タップした語数をそのまま数えているわけではありません。各語をいつ復習に出すかを決めているのと同じ FSRS 記憶モデルに基づいています。',
    '採点した直後は、どのボタンを押しても一時的にこの数字へ加算されます。押した瞬間はその語を確かに覚えているためです。違うのは、その後どれくらいの速さで薄れていくかです：',
    '・I know — ゆっくり薄れ、数週間はこの数字に残り続ける',
    '・Fuzzy — 1日程度で薄れる',
    '・Studying — 数時間で薄れ、まもなく復習に戻ってくる',
    'そのため、学習セッションの合間にFuzzy・Studyingの語が薄れて数字は自然に下がり、復習するたびにまた上がります。',
  ],
  meterAddedCount: (n) => `＋自分の追加 ${n}`,

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

  // 1回に並べるカードの枚数
  cardsPerSessionLabel: '1回に出すカードの枚数',
  cardsPerSessionOption: (n) => `${n}枚`,

  // 採点音の設定
  tapSoundLabel: '採点音',
  soundChime: 'チャイム',
  soundPop: 'ポン',
  soundMarimba: 'マリンバ',
  soundBell: 'ベル',
  soundOff: 'オフ',

  // 採点ボタン／レベル
  gradeKnown: '知ってる',
  gradeFuzzy: 'あいまい',
  gradeStudying: '学習中',
  gradeKnownShort: '既知',
  gradeFuzzyShort: '曖昧',
  gradeStudyingShort: '学習',
  mastered: '習得済み',

  // 学習セッションの状態
  preparingSession: 'セッションを準備中…',
  allCaughtUp: 'すべて完了',
  nothingDue: '今すぐ復習する語はありません。',
  resetProgressDemo: '進捗をリセット（デモ）',
  resetProgressConfirm:
    'このコースの学習記録（覚えた語・復習の予定日・学習履歴）をすべて消します。元に戻せません。実行しますか？',

  staleEpochTitle: 'このコースの学習記録は、いま表示されている単語と対応していません',
  staleEpochBody: (rows) =>
    `語彙データを作り直したときに単語の並びが変わり、${rows} 件の記録が別の単語に付いた可能性があります。` +
    '「覚えた」と記録された語が実際には出てこない状態が続きます。リセットすると、このコースを最初からやり直します。',
  staleEpochReset: 'このコースをリセット',
  staleEpochKeep: 'このまま使う',
  orphanNote: (n) => `いまのコースに存在しない単語の記録が ${n} 件あります`,

  serverSyncedAgo: (label) => `サーバー同期: ${label}前`,
  serverSyncNever: 'サーバー未同期',
  serverSyncBlocked: '⚠ 同期停止中（タップして確認）',
  serverSyncBlockedConfirm:
    'サーバーに保存されている記録より大幅に小さいデータで上書きしようとしています。' +
    '端末のデータが消えた直後などにこの警告が出ます。本当にこのデータで上書きしますか？',
  serverSyncUploading: '同期中…',

  restoreMergeToast: (added, updated) => `サーバーの記録と統合しました（追加 ${added} 語・更新 ${updated} 語）`,
  restoreMergeNoChange: 'すでに最新の状態でした（この端末の記録はそのままです）',
  restoreOfferTitle: 'サーバーに新しい学習記録があります',
  restoreOfferBody: (n) =>
    `別の端末で保存された記録（${n} 語）があります。取り込むと、この端末の記録と合わせます（同じ単語は新しい方を採用）。`,
  restoreOfferEpochWarning:
    'このコースの単語IDが作り直されているため、復元すると記録が別の単語に付く可能性があります。',
  restoreOfferKeepNotice: (n) => `この端末にしかない記録 ${n} 語ぶんは、そのまま残ります。`,
  restoreOfferCourseCounts: (title, local, snapshot) => `${title}：この端末 ${local} 語 / サーバー ${snapshot} 語`,
  restoreOfferAction: '取り込む',
  restoreOfferLoading: '取り込み中…',
  restoreOfferDismiss: '今はしない',
  restoreConfirmDialog:
    'サーバーの記録をこの端末の記録と統合します（同じ単語は新しい方を採用。この端末にしかない記録は残ります）。よろしいですか？',
  restoreUndo: '元に戻す',
  restoreUndoConfirm: '復元前の状態に戻します。よろしいですか？',
  restoreUndoDone: (n) => `元に戻しました（${n} 語）`,
  sessionComplete: 'セッション完了',
  sessionSummary: (reviewed, again) => `${reviewed} 回復習${again > 0 ? ` · ${again} 語を「学習中」に` : ''}`,

  // フォーカスシート
  tapToReveal: 'タップして表示',
  nextCard: '次のカード →',
  close: '閉じる',

  // カードの誤り報告
  reportButton: '誤りを報告',
  reportSheetTitle: 'このカードのどこが違いますか？',
  reportReasonGloss: '訳が違う',
  reportReasonReading: '読み・発音が違う',
  reportReasonPos: '品詞が違う',
  reportReasonExample: '例文がおかしい',
  reportReasonInappropriate: 'このコースに合わない語',
  reportReasonOther: 'その他',
  reportNotePlaceholder: 'ひとこと（任意）',
  reportSubmit: '報告する',
  reportSubmitting: '送信中…',
  reportCancel: 'キャンセル',
  reportSent: '報告しました。ありがとうございます。',
  reportQueued: 'オフラインのため、オンラインに戻ったら自動で送信します。',
  reportFailed: (message) => `送信できませんでした：${message}`,

  // 未割当コースのプレビュー
  previewIntro: 'これはプレビューです。リクエストする前にサンプルを確認できます。採点や進捗の保存はできません。',
  previewCardCount: (shown) => `先頭${shown}語のサンプルを表示中`,
  previewRequestButton: 'このコースの利用をリクエストする',
  previewRequesting: '送信中…',
  previewRequestSent: 'リクエストを送信しました。管理者が確認します。',
  previewAlreadyRequested: 'すでにこのコースをリクエスト済みです。管理者が確認します。',
  previewAlreadyGranted: 'このコースはすでに利用できます。もう一度切り替えてみてください。',
  previewRequestFailed: (message) => `送信できませんでした: ${message}`,

  // 語根表示
  rootLabel: '語根',

  // 音声読み上げ
  playAudio: '発音を再生',

  // 文脈クローズ
  clozeBadge: '穴埋め',

  // 単語検索（タブ行に常設）
  searchPlaceholder: 'このコース内を検索…',
  searchAria: 'このコース内の単語を検索',
  searchNoResults: '一致する単語がありません',
  searchAddLabel: 'このコースに追加',
  searchGenerateLabel: 'AIで生成',
  searchGenerating: '生成中…',
  searchGenerateRateLimited: '本日の上限（20語）に達しました。また明日お試しください',
  searchGenerateDisabled: 'この機能は現在停止中です',
  searchGenerateFailed: '生成できませんでした。しばらくしてからもう一度お試しください',

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

  // 品詞選択
  allPartsOfSpeech: 'すべての品詞',
  studyByPos: '品詞別に学習',
  noWordsForFilter: 'この絞り込みに合う語がありません。',
  clearFilters: '絞り込みを解除',

  // クレジット
  creditsButton: 'クレジット',
  dataCredits: 'データクレジット',
  sourceLicenseLabel: 'ライセンス:',
  noSourcesYet: 'このコースの出典情報はまだ登録されていません。',
}
