import { coverageAt } from '../data/coverage'
import { fmtNum } from '../text/format'

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
}

type Msg = (c: CoachContext) => string

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
const FIRST_VISIT: Msg[] = [
  () => 'Welcome! 👋 Tap any card to meet your first word — はじめましょう！',
  (c) => `${fmtNum(c.total)} words ahead, one tap at a time. Ready when you are 🌱`,
]

const COURSE_COMPLETE: Msg[] = [
  (c) => `All ${fmtNum(c.total)} words started — you did it! 🎉`,
  () => 'Course complete — お見事！ Keep the reviews warm ✨',
]

const NEAR_MILESTONE: Msg[] = [
  (c) => `Only ${nextMilestone(c) - c.introduced} words to ${fmtNum(nextMilestone(c))} — so close! 🔥`,
  (c) => `${nextMilestone(c) - c.introduced} more and you cross ${fmtNum(nextMilestone(c))}. Finish strong! 💪`,
  (c) => `${fmtNum(nextMilestone(c))} is right there — ${nextMilestone(c) - c.introduced} words away. あと少し！`,
]

const COMEBACK: Msg[] = [
  () => 'Welcome back! Your words missed you — the schedule already adjusted itself 😊',
  () => 'おかえりなさい！ No catch-up guilt: just start with today’s board 🌱',
  () => 'Back after a break — perfect timing. Small session, big momentum 💪',
]

const BIG_DAY: Msg[] = [
  (c) => `${c.todayReviews} reviews today — outstanding! 🎉`,
  () => 'You’re on fire today 🔥 Remember to rest those kanji muscles.',
  (c) => `${c.todayReviews} reviews?! お疲れさま — that’s real dedication ✨`,
]

// ── 低優先（プール合流）グループ ──────────────────────────
const TODAY_PROGRESS: Msg[] = [
  (c) => `${c.todayReviews} ${c.todayReviews === 1 ? 'review' : 'reviews'} in already — nice pace 👏`,
  () => 'Keep going — future you is already grateful ✨',
  (c) =>
    c.todayNew > 0
      ? `${c.todayNew} new ${c.todayNew === 1 ? 'word' : 'words'} started today 🌱 Every one counts.`
      : 'Reviews first, new words next — solid routine 👌',
  () => 'いい調子！ One card at a time.',
]

const STEADY_WEEK: Msg[] = [
  (c) => `${c.activeDaysThisWeek} active days this week — consistency is your superpower 💪`,
  () => 'Another day showing up. This is exactly how 3,000 happens 📈',
]

const MEMORY_BRAG: Msg[] = [
  (c) => `You can already catch ${coverageAt(c.estKnown ?? 0)}% of everyday conversation 👂`,
  (c) => `${fmtNum(c.estKnown ?? 0)} words live in your long-term memory — they’re staying ✨`,
]

const MASTERED_BRAG: Msg[] = [
  (c) => `${c.mastered} ${c.mastered === 1 ? 'word' : 'words'} mastered for good — 卒業 🏅`,
]

const GREETING_MORNING: Msg[] = [
  () => 'おはよう！ A few words with your morning coffee? ☕',
  () => 'Good morning — fresh mind, fresh words 🌅',
]
const GREETING_AFTERNOON: Msg[] = [
  () => 'こんにちは！ Perfect time for a quick session 🌞',
  () => 'Midday brain break = vocabulary time 📚',
]
const GREETING_EVENING: Msg[] = [
  () => 'こんばんは！ Wind down with a few words 🌆',
  () => 'Evening reviews hit different — calm and focused 🌙',
]
const GREETING_LATE: Msg[] = [
  () => 'Studying late? Dedication! Keep it light 🌙',
  () => 'Night-owl mode 🦉 A few cards, then rest well.',
]

function greetingPool(hour: number): Msg[] {
  if (hour >= 5 && hour < 11) return GREETING_MORNING
  if (hour >= 11 && hour < 17) return GREETING_AFTERNOON
  if (hour >= 17 && hour < 22) return GREETING_EVENING
  return GREETING_LATE
}

export function pickCoachMessage(c: CoachContext): string {
  const day = `${c.now.getFullYear()}-${c.now.getMonth() + 1}-${c.now.getDate()}`
  // 採点のたびに変わらないよう粗いバケツで安定化（学習開始時・10レビューごと・新規5語ごとに変わる）
  const seed = `${day}|${c.todayReviews > 0 ? 'active' : 'idle'}|${Math.floor(c.todayReviews / 10)}|${Math.floor(c.todayNew / 5)}|${c.introduced >= c.total ? 'done' : ''}`

  // 高優先: どれか1つが独占
  if (c.introduced === 0) return stablePick(FIRST_VISIT, seed)(c)
  if (c.introduced >= c.total && c.total > 0) return stablePick(COURSE_COMPLETE, seed)(c)
  if (nextMilestone(c) - c.introduced <= 30) return stablePick(NEAR_MILESTONE, seed)(c)
  if (c.todayReviews === 0 && c.gapDays !== null && c.gapDays >= 3) return stablePick(COMEBACK, seed)(c)
  if (c.todayReviews >= 60) return stablePick(BIG_DAY, seed)(c)

  // 低優先: 該当するプールを合流して選ぶ
  const pool: Msg[] = []
  if (c.todayReviews > 0) pool.push(...TODAY_PROGRESS)
  if (c.activeDaysThisWeek >= 4) pool.push(...STEADY_WEEK)
  if ((c.estKnown ?? 0) >= 50) pool.push(...MEMORY_BRAG)
  if (c.mastered >= 5) pool.push(...MASTERED_BRAG)
  if (c.todayReviews === 0) pool.push(...greetingPool(c.now.getHours()))
  if (pool.length === 0) pool.push(...greetingPool(c.now.getHours()))

  return stablePick(pool, seed)(c)
}
