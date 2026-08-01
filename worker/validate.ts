import type { CourseProgressInput, SyncInput } from './types'

/**
 * 受信データの検証。クライアントは信用しない前提で、
 * 「型が合わない・桁が異常・件数が多すぎる」入力はここで落とすか丸める。
 */

/** 入力が不正（400 を返す） */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ローカル部にカンマ・空白・引用符などを許さない実務的な範囲。RFC 完全準拠は狙わない
// （Access 側でも弾かれるため、ここは「リストを壊す文字を通さない」ことが目的）。
const EMAIL_RE = /^[^\s@,;<>"'\\]{1,64}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

/** メールを正規化して返す。不正なら ValidationError */
export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('メールアドレスが指定されていません')
  const email = raw.trim().toLowerCase()
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new ValidationError(`メールアドレスの形式が不正です: ${clip(email, 80)}`)
  return email
}

/** 表示名・メモ等の自由入力。長さで切り、制御文字を除去する */
export function cleanText(raw: unknown, max: number): string {
  if (raw == null) return ''
  if (typeof raw !== 'string') throw new ValidationError('文字列を指定してください')
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** 0 以上の整数へ丸める（NaN・負・巨大値・小数を潰す） */
function count(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0
  return Math.min(Math.max(n, 0), 10_000_000)
}

const COURSE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 「その人が使えるコース」の指定を検証する。空配列＝制限なし（全コース）。
 * 未知のコース ID も受ける（コースを増やすたびに Worker を直さなくて済む）が、形式だけは縛る。
 */
export function parseCourseIdList(raw: unknown): string[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new ValidationError('コースの指定が配列ではありません')
  if (raw.length > 50) throw new ValidationError('コースの指定が多すぎます')
  const seen = new Set<string>()
  for (const v of raw) {
    const id = typeof v === 'string' ? v.trim() : ''
    if (!COURSE_ID_RE.test(id)) throw new ValidationError(`コースIDの形式が不正です: ${clip(String(v), 40)}`)
    seen.add(id)
  }
  return [...seen]
}

/** POST /api/sync の本体を検証して正規化する */
export function parseSyncInput(raw: unknown): SyncInput {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('リクエスト本体が不正です')
  const courses = (raw as { courses?: unknown }).courses
  if (!Array.isArray(courses)) throw new ValidationError('courses が配列ではありません')
  // コース数は多くても十数件。異常な件数は打ち切る（DB書き込みの暴発防止）
  if (courses.length > 50) throw new ValidationError('courses の件数が多すぎます')

  const parsed: CourseProgressInput[] = []
  for (const c of courses) {
    if (typeof c !== 'object' || c === null) continue
    const o = c as Record<string, unknown>
    const courseId = typeof o.courseId === 'string' ? o.courseId.trim() : ''
    // 未知のコースIDでも受ける（コース追加のたびに Worker を直さなくて済む）。
    // ただし形式だけは縛る＝表示崩れ・キー汚染を防ぐ。
    if (!COURSE_ID_RE.test(courseId)) continue
    const lastStudiedDate =
      typeof o.lastStudiedDate === 'string' && DATE_RE.test(o.lastStudiedDate) ? o.lastStudiedDate : null
    parsed.push({
      courseId,
      started: count(o.started),
      known: count(o.known),
      mastered: count(o.mastered),
      reviews: count(o.reviews),
      daysStudied: count(o.daysStudied),
      streak: count(o.streak),
      longestStreak: count(o.longestStreak),
      lastStudiedDate,
    })
  }
  return { courses: parsed }
}
