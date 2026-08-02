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
// auth.ts が JWT の email クレームを Identity に変換する境界でも同じ正規表現を使う
// （R2 オブジェクトキーのパス要素に埋め込む前に、パス区切り文字等を確実に弾くため）。
export const EMAIL_RE = /^[^\s@,;<>"'\\]{1,64}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

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

/**
 * POST /api/words/generate の本体を検証して正規化する（見出し語の中身の妥当性は wordgen.ts が見る）。
 * 生成対象の言語（学習言語・訳の言語）はここでは受け取らない——クライアント申告を信用すると
 * ① AI プロンプトへの injection 経路になる ②生成キャッシュが言語を鍵に含まないため誤った言語の
 * カードが恒久的に配信され続ける、の2つの実害がある（2026-08-02 security-reviewer 指摘）。
 * courseId から Worker 自身がコースの meta.json を読んで言語を決める（wordgen.ts 参照）。
 */
export function parseWordGenInput(raw: unknown): { courseId: string; headword: string } {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('リクエスト本体が不正です')
  const o = raw as Record<string, unknown>
  const courseId = typeof o.courseId === 'string' ? o.courseId.trim() : ''
  if (!COURSE_ID_RE.test(courseId)) throw new ValidationError('コースIDの形式が不正です')
  const headword = typeof o.headword === 'string' ? o.headword.trim() : ''
  if (!headword || headword.length > 40) throw new ValidationError('見出し語の形式が不正です')
  return { courseId, headword }
}

// wordgen.ts の makeCardId() が作る形式（<courseId>-x<8桁16進>）とだけ一致させる。
// 管理画面の昇格・削除は card_id を直接指定するので、ここで形式を縛っておけば
// 想定外の文字列が SQL の bind パラメータとして DB まで届く前に落とせる。
const CARD_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}-x[0-9a-f]{8}$/

/** 管理画面の昇格・削除リクエストが指定する card_id を検証する */
export function parseCardId(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('card_id が必要です')
  const id = raw.trim()
  if (!CARD_ID_RE.test(id)) throw new ValidationError('card_id の形式が不正です')
  return id
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
