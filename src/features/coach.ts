import { courseProgress } from '../data/coverage'
import { fmtNum } from '../text/format'
import type { CoachSentence } from '../data/coachSentences'
import type { Course } from '../types'
import { EN_PLAIN_POOLS, EN_POOLS, JA_POOLS, type CoachMessagePools } from './coachMessages'

/** 固定文の配列を Msg（関数）プールに変換 */
const fixed = (list: readonly string[]): Msg[] => list.map((s) => () => s)

/**
 * ヘッダー左上の「コーチ・メッセージ」。
 * 端末内のデータ（今日の学習量・復帰間隔・節目までの距離・週の学習日数・時間帯…）だけから、
 * 人に応援されているように感じる一言を選ぶ。完全クライアントサイド・外部送信なし。
 *
 * 仕組み:
 * - 高優先グループ（初回・完走・節目目前・復帰・大量学習）はどれか1つが独占的に出る
 * - それ以外（今日の進み・週の継続・記憶量の自慢・時間帯の挨拶）は該当分を全部プールして選ぶ
 * - 選択は「日付＋粗い状態バケツ」のハッシュで安定化＝学習が進むと切り替わるが、採点のたびに
 *   チカチカ変わらない。文中の数字は描画時に評価するのでカウントダウン等は常に最新
 * - 固定文プール（JA_POOLS/EN_POOLS/EN_PLAIN_POOLS）は course.uiLanguage＋learningLanguage で
 *   切り替える（1.5.6・2026-07-30コースA/B英語UI化で3プール化）。EN_POOLS は学習言語=日本語の
 *   メンバー系コース（C/D/E）専用——英語文言に日本語の単語をあえて混ぜる演出。それ以外の英語UI
 *   コース（A/B）は日本語を混ぜない EN_PLAIN_POOLS。数字入りの動的テンプレート（NEAR_MILESTONE・
 *   MEMORY_BRAG 等）も同じ判定で英日/日本語混在の出し分けをする（isJa()/isJaFlavor() ヘルパー。
 *   pools 引数と違い各 Msg は c を受け取るため、その場で判定すれば足りる）
 */
export interface CoachContext {
  now: Date
  /** words started */
  introduced: number
  total: number
  /** 推定語彙数（retrievability 合計）。ロード前は null */
  estKnown: number | null
  /** 卒業（Mastered）数 */
  mastered: number
  todayReviews: number
  todayNew: number
  /** 今日を除く直近の学習日からの経過日数（学習履歴が無ければ null） */
  gapDays: number | null
  /** 今週（月曜始まり）の学習日数 */
  activeDaysThisWeek: number
  /** 「I know」扱いの語の cardId 集合（コーチの日本語文の解禁判定） */
  knownIds: Set<string>
  /** 既習語だけで組んだ日本語文のバンク（words ⊆ knownIds の文だけ画面に出す） */
  sentences: CoachSentence[]
  /**
   * コース（type は MEMORY_BRAG の被覆率算出に、uiLanguage は固定文プールの選択に、
   * learningLanguage は「英語UI＋学習言語=日本語の文言に学習言語の単語を混ぜるか」の判定に使う）。
   */
  course: Pick<Course, 'type' | 'uiLanguage' | 'learningLanguage'>
}

/** コーチの一言（text＝メイン表示、sub＝日本語文のときの英訳） */
export interface CoachLine {
  text: string
  sub?: string
}

type Msg = (c: CoachContext) => string

/** コースの UI 言語が日本語か（動的テンプレートの英日出し分けに使う） */
function isJa(c: CoachContext): boolean {
  return c.course.uiLanguage === 'ja'
}

/**
 * 英語UIの文言に学習言語（日本語）の単語をあえて混ぜるコースか。
 * 対象は「UI=英語・学習言語=日本語」のメンバー系コース（C/D/E）のみ——学習中の言語に軽く触れ続ける
 * 演出。UI=英語でも学習言語が日本語でないコース（A: 英語・B: タガログ語）はプレーン英語（EN_PLAIN_POOLS）。
 */
function isJaFlavor(c: CoachContext): boolean {
  return c.course.uiLanguage === 'en' && c.course.learningLanguage === 'Japanese'
}

/** 文字列ハッシュで候補から1つを安定選択 */
function stablePick(pool: Msg[], seed: string): Msg {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return pool[Math.abs(h) % pool.length]
}

function nextMilestone(c: CoachContext): number {
  return Math.min(Math.ceil((c.introduced + 1) / 500) * 500, c.total)
}

// ── 高優先（独占）グループ ──────────────────────────────
// 固定文プール（pools）を引数に取り、EN_POOLS/JA_POOLS を pickCoachMessage が選んで渡す。
function firstVisitPool(pools: CoachMessagePools): Msg[] {
  return [
    (c) =>
      isJa(c)
        ? 'ようこそ！👋 カードをタップして最初の単語に出会いましょう。'
        : isJaFlavor(c)
          ? 'Welcome! 👋 Tap any card to meet your first word — はじめましょう！'
          : 'Welcome! 👋 Tap any card to meet your first word.',
    (c) =>
      isJa(c)
        ? `全 ${fmtNum(c.total)} 語があなたを待っています。準備ができたらタップしてくださいね 🌱`
        : `${fmtNum(c.total)} words ahead, one tap at a time. Ready when you are 🌱`,
    ...fixed(pools.firstVisit),
  ]
}

function courseCompletePool(pools: CoachMessagePools): Msg[] {
  return [
    (c) =>
      isJa(c)
        ? `全 ${fmtNum(c.total)} 語、スタート達成——やりましたね！🎉`
        : `All ${fmtNum(c.total)} words started — you did it! 🎉`,
    (c) =>
      isJa(c)
        ? 'コース完了——お見事！復習を続けて、感覚を温め続けましょう ✨'
        : isJaFlavor(c)
          ? 'Course complete — お見事！ Keep the reviews warm ✨'
          : 'Course complete — well done! Keep the reviews warm ✨',
    ...fixed(pools.courseComplete),
  ]
}

const NEAR_MILESTONE: Msg[] = [
  (c) =>
    isJa(c)
      ? `${fmtNum(nextMilestone(c))} まであと ${nextMilestone(c) - c.introduced} 語——もう少し！🔥`
      : `Only ${nextMilestone(c) - c.introduced} words to ${fmtNum(nextMilestone(c))} — so close! 🔥`,
  (c) =>
    isJa(c)
      ? `あと ${nextMilestone(c) - c.introduced} 語で ${fmtNum(nextMilestone(c))} 突破。ラストスパート！💪`
      : `${nextMilestone(c) - c.introduced} more and you cross ${fmtNum(nextMilestone(c))}. Finish strong! 💪`,
  (c) =>
    isJa(c)
      ? `${fmtNum(nextMilestone(c))} まであと ${nextMilestone(c) - c.introduced} 語。あと少し！`
      : isJaFlavor(c)
        ? `${fmtNum(nextMilestone(c))} is right there — ${nextMilestone(c) - c.introduced} words away. あと少し！`
        : `${fmtNum(nextMilestone(c))} is right there — ${nextMilestone(c) - c.introduced} words away. Almost there!`,
]

function comebackPool(pools: CoachMessagePools): Msg[] {
  return [
    (c) =>
      isJa(c)
        ? 'おかえりなさい！単語たちが待っていましたよ——スケジュールはもう調整済みです 😊'
        : 'Welcome back! Your words missed you — the schedule already adjusted itself 😊',
    (c) =>
      isJa(c)
        ? 'おかえりなさい！追いつく必要はありません、今日のボードから始めましょう 🌱'
        : isJaFlavor(c)
          ? 'おかえりなさい！ No catch-up guilt: just start with today’s board 🌱'
          : 'Welcome back! No catch-up guilt: just start with today’s board 🌱',
    (c) =>
      isJa(c)
        ? '休憩明け、いいタイミングです。小さなセッションが大きな弾みになります 💪'
        : 'Back after a break — perfect timing. Small session, big momentum 💪',
    ...fixed(pools.comeback),
  ]
}

function bigDayPool(pools: CoachMessagePools): Msg[] {
  return [
    (c) =>
      isJa(c) ? `今日の復習 ${c.todayReviews} 件——お見事です！🎉` : `${c.todayReviews} reviews today — outstanding! 🎉`,
    (c) =>
      isJa(c)
        ? '今日は絶好調ですね 🔥 頑張った分、頭もしっかり休ませてくださいね。'
        : isJaFlavor(c)
          ? 'You’re on fire today 🔥 Remember to rest those kanji muscles.'
          : 'You’re on fire today 🔥 Remember to rest that brain too.',
    (c) =>
      isJa(c)
        ? `今日の復習、${c.todayReviews} 件!? お疲れさまでした——本物の頑張りです ✨`
        : isJaFlavor(c)
          ? `${c.todayReviews} reviews?! お疲れさま — that’s real dedication ✨`
          : `${c.todayReviews} reviews?! Well done — that’s real dedication ✨`,
    ...fixed(pools.bigDay),
  ]
}

// ── 低優先（プール合流）グループ ──────────────────────────
function todayProgressPool(pools: CoachMessagePools): Msg[] {
  return [
    (c) =>
      isJa(c)
        ? `今日はもう ${c.todayReviews} 件の復習——いいペースです 👏`
        : `${c.todayReviews} ${c.todayReviews === 1 ? 'review' : 'reviews'} in already — nice pace 👏`,
    (c) => (isJa(c) ? 'その調子——未来のあなたがもう感謝していますよ ✨' : 'Keep going — future you is already grateful ✨'),
    (c) => {
      if (isJa(c)) {
        return c.todayNew > 0
          ? `今日は新しい単語を ${c.todayNew} 語スタート 🌱 どれも大事な一歩です。`
          : '復習を先に、新しい単語はそのあと——いい流れです 👌'
      }
      return c.todayNew > 0
        ? `${c.todayNew} new ${c.todayNew === 1 ? 'word' : 'words'} started today 🌱 Every one counts.`
        : 'Reviews first, new words next — solid routine 👌'
    },
    (c) =>
      isJa(c) ? 'いい調子！一枚ずつ、着実に。' : isJaFlavor(c) ? 'いい調子！ One card at a time.' : 'Nice pace! One card at a time.',
    ...fixed(pools.todayProgress),
  ]
}

function steadyWeekPool(pools: CoachMessagePools): Msg[] {
  return [
    (c) =>
      isJa(c)
        ? `今週は ${c.activeDaysThisWeek} 日学習——継続はあなたの強みです 💪`
        : `${c.activeDaysThisWeek} active days this week — consistency is your superpower 💪`,
    (c) =>
      isJa(c)
        ? '今日も学習を続けています——コツコツの積み重ねが、いずれ3,000語になります 📈'
        : 'Another day showing up. This is exactly how 3,000 happens 📈',
    ...fixed(pools.steadyWeek),
  ]
}

/**
 * 記憶量の自慢グループ。coverage.ts の courseProgress で帯別の意味づけに従う
 * （rail/cloze=被覆率%、calibrate-mine=語数のみ。この文脈に depth は無いので付記しない）。
 */
const MEMORY_BRAG: Msg[] = [
  (c) => {
    const progress = courseProgress(c.course, c.estKnown ?? 0)
    if (isJa(c)) {
      return progress.mode === 'coverage-pct'
        ? `もう${progress.domain === 'written' ? '書き言葉' : '日常会話'}の${progress.pct}%が分かるようになっています 👂`
        : `${fmtNum(c.estKnown ?? 0)} 語があなたの長期記憶に定着しています——もう忘れません ✨`
    }
    return progress.mode === 'coverage-pct'
      ? `You can already catch ${progress.pct}% of ${progress.domain === 'written' ? 'written text' : 'everyday conversation'} 👂`
      : `${fmtNum(c.estKnown ?? 0)} words live in your long-term memory — they’re staying ✨`
  },
  (c) =>
    isJa(c)
      ? `${fmtNum(c.estKnown ?? 0)} 語があなたの長期記憶に定着しています——もう忘れません ✨`
      : `${fmtNum(c.estKnown ?? 0)} words live in your long-term memory — they’re staying ✨`,
]

const MASTERED_BRAG: Msg[] = [
  (c) =>
    isJa(c)
      ? `${c.mastered} 語を完全習得——卒業です 🏅`
      : isJaFlavor(c)
        ? `${c.mastered} ${c.mastered === 1 ? 'word' : 'words'} mastered for good — 卒業 🏅`
        : `${c.mastered} ${c.mastered === 1 ? 'word' : 'words'} mastered for good — graduated 🏅`,
]

function greetingMorningPool(pools: CoachMessagePools): Msg[] {
  return [
    (c) =>
      isJa(c)
        ? 'おはようございます！朝のコーヒーと一緒に少し単語はいかがですか？ ☕'
        : isJaFlavor(c)
          ? 'おはよう！ A few words with your morning coffee? ☕'
          : 'Good morning! A few words with your morning coffee? ☕',
    (c) => (isJa(c) ? 'おはようございます——頭も新鮮、単語も新鮮です 🌅' : 'Good morning — fresh mind, fresh words 🌅'),
    ...fixed(pools.greetingMorning),
  ]
}
function greetingAfternoonPool(pools: CoachMessagePools): Msg[] {
  return [
    (c) =>
      isJa(c)
        ? 'こんにちは！ちょっとしたセッションにぴったりの時間です 🌞'
        : isJaFlavor(c)
          ? 'こんにちは！ Perfect time for a quick session 🌞'
          : 'Good afternoon! Perfect time for a quick session 🌞',
    (c) => (isJa(c) ? '午後の一息に、単語タイムはいかがですか 📚' : 'Midday brain break = vocabulary time 📚'),
    ...fixed(pools.greetingAfternoon),
  ]
}
function greetingEveningPool(pools: CoachMessagePools): Msg[] {
  return [
    (c) =>
      isJa(c)
        ? 'こんばんは！単語と一緒にひと息つきませんか 🌆'
        : isJaFlavor(c)
          ? 'こんばんは！ Wind down with a few words 🌆'
          : 'Good evening! Wind down with a few words 🌆',
    (c) => (isJa(c) ? '夜の復習は、また違った落ち着きがあります 🌙' : 'Evening reviews hit different — calm and focused 🌙'),
    ...fixed(pools.greetingEvening),
  ]
}
function greetingLatePool(pools: CoachMessagePools): Msg[] {
  return [
    (c) => (isJa(c) ? '遅くまでお疲れさまです！短く、軽く済ませましょう 🌙' : 'Studying late? Dedication! Keep it light 🌙'),
    (c) => (isJa(c) ? '夜更かしモードですね 🦉 少しだけカードをこなして、ゆっくり休んでください。' : 'Night-owl mode 🦉 A few cards, then rest well.'),
    ...fixed(pools.greetingLate),
  ]
}

function greetingPool(hour: number, pools: CoachMessagePools): Msg[] {
  if (hour >= 5 && hour < 11) return greetingMorningPool(pools)
  if (hour >= 11 && hour < 17) return greetingAfternoonPool(pools)
  if (hour >= 17 && hour < 22) return greetingEveningPool(pools)
  return greetingLatePool(pools)
}

function hourTag(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

/** 今の状況に合うタグの、必須単語を全部覚えている日本語文だけを返す */
function unlockedSentences(c: CoachContext, tags: Set<string>): CoachSentence[] {
  if (c.sentences.length === 0 || c.knownIds.size === 0) return []
  return c.sentences.filter((s) => tags.has(s.tag) && s.words.every((w) => c.knownIds.has(w)))
}

function hashOf(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function pickCoachMessage(c: CoachContext): CoachLine {
  // 固定文プールはコースの UI 言語＋学習言語で切り替える（メンバー系 C/D/E=EN_POOLS・
  // A/B=EN_PLAIN_POOLS・将来の日本語UIコース=JA_POOLS）。
  const pools = isJa(c) ? JA_POOLS : isJaFlavor(c) ? EN_POOLS : EN_PLAIN_POOLS
  const day = `${c.now.getFullYear()}-${c.now.getMonth() + 1}-${c.now.getDate()}`
  // 採点のたびに変わらないよう粗いバケツで安定化（学習開始時・10レビューごと・新規5語ごとに変わる）
  const seed = `${day}|${c.todayReviews > 0 ? 'active' : 'idle'}|${Math.floor(c.todayReviews / 10)}|${Math.floor(c.todayNew / 5)}|${c.introduced >= c.total ? 'done' : ''}`
  const jpLine = (s: CoachSentence): CoachLine => ({ text: s.text, sub: s.translation })

  // 高優先: どれか1つが独占。復帰と大量学習は、解禁済みの日本語文があれば半々で日本語に
  if (c.introduced === 0) return { text: stablePick(firstVisitPool(pools), seed)(c) }
  if (c.introduced >= c.total && c.total > 0) return { text: stablePick(courseCompletePool(pools), seed)(c) }
  if (nextMilestone(c) - c.introduced <= 30) {
    const jp = unlockedSentences(c, new Set(['milestone']))
    if (jp.length > 0 && hashOf(seed) % 2 === 0) return jpLine(jp[hashOf(seed + 'jp') % jp.length])
    return { text: stablePick(NEAR_MILESTONE, seed)(c) }
  }
  if (c.todayReviews === 0 && c.gapDays !== null && c.gapDays >= 3) {
    const jp = unlockedSentences(c, new Set(['comeback']))
    if (jp.length > 0 && hashOf(seed) % 2 === 0) return jpLine(jp[hashOf(seed + 'jp') % jp.length])
    return { text: stablePick(comebackPool(pools), seed)(c) }
  }
  if (c.todayReviews >= 60) {
    const jp = unlockedSentences(c, new Set(['bigday', 'praise']))
    if (jp.length > 0 && hashOf(seed) % 2 === 0) return jpLine(jp[hashOf(seed + 'jp') % jp.length])
    return { text: stablePick(bigDayPool(pools), seed)(c) }
  }

  // 低優先: 状況に合うタグの日本語文を優先（2/3）、残りは英語プールを合流して選ぶ
  const tags = new Set<string>(['encourage', 'any', hourTag(c.now.getHours())])
  if (hourTag(c.now.getHours()) === 'evening' || hourTag(c.now.getHours()) === 'night') tags.add('rest')
  if (c.todayReviews > 0) tags.add('praise')
  const jp = unlockedSentences(c, tags)
  if (jp.length > 0 && hashOf(seed) % 3 !== 0) return jpLine(jp[hashOf(seed + 'jp') % jp.length])

  const pool: Msg[] = []
  if (c.todayReviews > 0) pool.push(...todayProgressPool(pools))
  if (c.activeDaysThisWeek >= 4) pool.push(...steadyWeekPool(pools))
  if ((c.estKnown ?? 0) >= 50) pool.push(...MEMORY_BRAG)
  if (c.mastered >= 5) pool.push(...MASTERED_BRAG)
  if (c.todayReviews === 0) pool.push(...greetingPool(c.now.getHours(), pools))
  if (pool.length === 0) pool.push(...greetingPool(c.now.getHours(), pools))

  return { text: stablePick(pool, seed)(c) }
}
