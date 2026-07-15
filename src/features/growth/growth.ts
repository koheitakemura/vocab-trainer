import type { DailyStat } from '../../types'
import { localDate } from '../../store/progress'

/**
 * 成長タブのデータモデル（純粋ロジック。DB 依存なし＝単体で検証できる）。
 * 「学習した語彙（started）」と「覚えた語彙（known）」の累積を日付ごとに並べた成長曲線。
 * データ源は dailyStats（1コース×1日＝1行の追記型ログ）＋現在のサマリ（端点の真値）。
 */

/** 成長曲線の1点（その日終了時点の累積） */
export interface GrowthPoint {
  /** ローカル日付 YYYY-MM-DD */
  date: string
  /** 累積の学習した語彙数（words started） */
  started: number
  /** 覚えた語彙数（I know＋Mastered。knownTotal スナップショット） */
  known: number
}

/** 成長タブが描く全データ（曲線＋見出し数字） */
export interface GrowthSeries {
  /** 日付昇順の成長曲線。末尾は必ず today（現在の真値で固定） */
  points: GrowthPoint[]
  /** 現在の学習した語彙数（＝ヘッダーの introduced と一致） */
  started: number
  /** 現在の覚えた語彙数（good+easy+burned） */
  known: number
  /** 現在の卒業（Mastered）語数 */
  mastered: number
  /** レビュー実績のあった延べ日数 */
  activeDays: number
  /** 記録開始以降の累計レビュー回数 */
  reviews: number
  /** 現在の連続学習日数（today か、まだ今日やっていなければ昨日まで） */
  currentStreak: number
  /** これまでの最長連続日数 */
  longestStreak: number
  /** 記録が始まった最初の日（無ければ null） */
  firstDate: string | null
}

/** 現在のサマリ（成長曲線の端点を真値に固定するために渡す） */
export interface GrowthNow {
  /** 一度でも採点した語数（words started） */
  introduced: number
  /** 覚えた語数（good+easy+burned）＝ knownTotal と同じ定義 */
  known: number
  /** 卒業（Mastered/Burned）語数 */
  mastered: number
}

/** 'YYYY-MM-DD' → ローカル Date（正午基準＝DST の境界でも日付がずれない） */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

/** 日付文字列を n 日ずらす（YYYY-MM-DD → YYYY-MM-DD） */
export function shiftDate(s: string, n: number): string {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return localDate(d)
}

/** 2つの日付文字列の差（日数。a→b が未来なら正） */
export function dayDiff(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000)
}

/**
 * 連続学習日数を計算する。
 * - longest: レビュー実績日を昇順に見て連続する最長ラン
 * - current: today から遡って連続する長さ。まだ今日やっていない場合は昨日まで数える
 *   （＝当日ぶんの猶予。Duolingo と同じで「今日やらないと切れる」手前の状態も継続として見せる）
 */
export function computeStreaks(activeDates: string[], today: string): { current: number; longest: number } {
  if (activeDates.length === 0) return { current: 0, longest: 0 }
  const sorted = [...new Set(activeDates)].sort()
  const set = new Set(sorted)

  let longest = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    run = dayDiff(sorted[i - 1], sorted[i]) === 1 ? run + 1 : 1
    if (run > longest) longest = run
  }

  // today からの継続を数える。今日未実施なら1日ぶん遡って（猶予）判定する
  let cursor = set.has(today) ? today : shiftDate(today, -1)
  if (!set.has(cursor)) return { current: 0, longest }
  let current = 0
  while (set.has(cursor)) {
    current++
    cursor = shiftDate(cursor, -1)
  }
  return { current, longest }
}

/**
 * dailyStats と現在サマリから成長曲線を組み立てる。
 *
 * started（学習した語彙）の逆算：introduced は記録開始前の既習ぶんも含むため、
 * newStarted の累積だけだと現在値に届かない。そこで
 *   baseline = introduced − Σ newStarted（記録開始前の土台。負にはしない）
 * を全日に足し、末尾を introduced に一致させる（＝ヘッダーの数字と必ず揃う）。
 *
 * known（覚えた語彙）は knownTotal が絶対スナップショットなのでそのまま採用。
 * 末尾（today）は現在サマリの真値で上書きし、当日の未確定ぶんも正しく見せる。
 */
export function buildGrowth(stats: DailyStat[], now: GrowthNow, today: string): GrowthSeries {
  // 未来日付の行は除外する。端末時計のずれ・時差移動・誤時計端末のバックアップ取り込みで
  // today より後の日付が入り得る。残すと末尾＝today の昇順不変条件が崩れ、曲線が画面外へ飛び
  // 集計（activeDays/reviews/streak）も水増しされる。'YYYY-MM-DD' は文字列比較で日付順に一致。
  const sorted = [...stats].filter((s) => s.date <= today).sort((a, b) => a.date.localeCompare(b.date))

  let reviews = 0
  let activeDays = 0
  let totalNew = 0
  const activeDates: string[] = []
  for (const s of sorted) {
    reviews += s.reviews
    totalNew += s.newStarted
    if (s.reviews > 0) {
      activeDays++
      activeDates.push(s.date)
    }
  }

  const baseline = Math.max(0, now.introduced - totalNew)
  const points: GrowthPoint[] = []
  let cumStarted = baseline
  for (const s of sorted) {
    cumStarted += s.newStarted
    points.push({ date: s.date, started: cumStarted, known: s.knownTotal })
  }

  // 末尾を today の真値に固定する（記録があってもなくても、現在サマリで端点を正す）。
  const last = points[points.length - 1]
  if (last && last.date === today) {
    last.started = now.introduced
    last.known = now.known
  } else {
    points.push({ date: today, started: now.introduced, known: now.known })
  }

  const { current, longest } = computeStreaks(activeDates, today)

  return {
    points,
    started: now.introduced,
    known: now.known,
    mastered: now.mastered,
    activeDays,
    reviews,
    currentStreak: current,
    longestStreak: longest,
    firstDate: sorted.length > 0 ? sorted[0].date : null,
  }
}
