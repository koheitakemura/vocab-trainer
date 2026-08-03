import { requireAdmin } from './auth'
import { writeAdminLog } from './store'
import { ValidationError, cleanText } from './validate'
import { startOfTodayIso } from './wordgen'
import type { Env, Identity } from './types'

/**
 * カードの誤り報告＋管理者による是正（corrections）。
 *
 * このモジュールは意図的に自己完結させている——2026-08-02 時点で別セッションが
 * worker/index.ts・validate.ts・wordgen.ts を並行編集中だったため（単語生成の多言語対応）、
 * 衝突面を減らす目的で「自前の D1 スキーマ・自前の JSON レスポンス組み立て」を持つ設計にした
 * （parallel-session-collision-check メモリの「新規ファイル中心・既存への変更は最小限」に従う）。
 * index.ts 側は各ハンドラを呼ぶだけの薄いルーティング。一般利用者向け（報告送信・是正取得）は
 * index.ts が ensureActiveUser を先に呼んでから委譲する（index.ts の private 関数を reports.ts
 * から import できないため）。管理者向け4件は auth.ts の requireAdmin を各ハンドラ自身が呼ぶ
 * ——index.ts 側での呼び忘れが起きない自己完結の形にしてある（後述のバグの再発防止）。
 *
 * 報告と是正は別テーブル：
 * - card_reports：利用者が送る「このカードはおかしい」の1件（誰が・どのカードの・何が）。
 *   同じカードに複数件つくことを前提に、各行が完全なスナップショット（見出し語・訳・例文等）を
 *   持つ——cardId だけで紐付けると、cardId が別の語を指す事故（cardid-position-based-fragility）が
 *   起きたときに「どの語のことか分からない報告」になるため。
 * - card_corrections：管理者が確定させた「この語彙欄はこれが正しい」（cardId 主キー・1件のみ）。
 *   部分パッチではなく常にフルセット（headword/reading/gloss/pos/examples 全部）を保存する——
 *   NULL＝上書きしないという半端な状態を持たせると「何が反映されているか」が読みづらくなるため、
 *   管理画面は常に現在値をフォームへ複製してから編集させる。
 */

// ── D1 スキーマ（store.ts の SCHEMA には入れない。ensureSchema と衝突しない独立管理） ──

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS card_reports (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     at         TEXT NOT NULL,
     email      TEXT NOT NULL,
     course_id  TEXT NOT NULL,
     card_id    TEXT NOT NULL,
     id_epoch   INTEGER NOT NULL DEFAULT 1,
     headword   TEXT NOT NULL,
     reading    TEXT NOT NULL DEFAULT '',
     gloss      TEXT NOT NULL DEFAULT '',
     pos        TEXT NOT NULL DEFAULT '',
     examples   TEXT NOT NULL DEFAULT '[]',
     reason     TEXT NOT NULL,
     note       TEXT NOT NULL DEFAULT '',
     status     TEXT NOT NULL DEFAULT 'open',
     admin_note TEXT NOT NULL DEFAULT '',
     updated_at TEXT NOT NULL
   )`,
  // countTodayReports の WHERE email=? AND at>=? を全表スキャンにしない（word_gen_log と同じ理由）
  `CREATE INDEX IF NOT EXISTS idx_card_reports_rate ON card_reports(email, at)`,
  // 管理画面で同じカードへの複数報告をまとめて表示するための絞り込み
  `CREATE INDEX IF NOT EXISTS idx_card_reports_card ON card_reports(course_id, card_id)`,
  `CREATE TABLE IF NOT EXISTS card_corrections (
     card_id    TEXT PRIMARY KEY,
     course_id  TEXT NOT NULL,
     headword   TEXT NOT NULL,
     reading    TEXT NOT NULL DEFAULT '',
     gloss      TEXT NOT NULL,
     pos        TEXT NOT NULL DEFAULT '',
     examples   TEXT NOT NULL DEFAULT '[]',
     updated_at TEXT NOT NULL,
     updated_by TEXT NOT NULL
   )`,
  // 端末が起動時に「このコースの是正」だけを取りに来る（GET /api/corrections?courseId=）
  `CREATE INDEX IF NOT EXISTS idx_card_corrections_course ON card_corrections(course_id)`,
]

let schemaReady = false

async function ensureReportsSchema(env: Env): Promise<void> {
  if (schemaReady) return
  await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)))
  schemaReady = true
}

/** 1人1日の報告上限。誤って連打しても際限なく溜まらないようにする程度の緩い上限 */
export const REPORT_RATE_LIMIT_PER_DAY = 20

export class ReportError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ReportError'
  }
}

// ── 検証 ──

const COURSE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
// パイプライン採番（<courseId>-XXXX の数字連番）と AI生成カード（<courseId>-x8桁16進）の
// どちらも通す緩めの形式チェック。厳密な採番規則はここでは縛らない（validate.ts の
// parseCardId は extra_cards 専用の厳格版で、これとは別物）。
const CARD_ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/

export const REPORT_REASONS = ['gloss', 'reading', 'pos', 'example', 'inappropriate', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

const REPORT_STATUSES = ['open', 'planned', 'fixed', 'rejected'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

function requiredText(raw: unknown, max: number, field: string): string {
  const s = cleanText(raw, max)
  if (!s) throw new ValidationError(`${field}が指定されていません`)
  return s
}

export interface ReportExample {
  text: string
  translation: string
}

function parseExamples(raw: unknown, max = 5): ReportExample[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new ValidationError('examples が配列ではありません')
  if (raw.length > max) throw new ValidationError('examples の件数が多すぎます')
  return raw.map((e) => {
    if (typeof e !== 'object' || e === null) throw new ValidationError('example の形式が不正です')
    const o = e as Record<string, unknown>
    return { text: cleanText(o.text, 300), translation: cleanText(o.translation, 300) }
  })
}

function parseCourseId(raw: unknown): string {
  const courseId = typeof raw === 'string' ? raw.trim() : ''
  if (!COURSE_ID_RE.test(courseId)) throw new ValidationError('コースIDの形式が不正です')
  return courseId
}

function parseAnyCardId(raw: unknown): string {
  const cardId = typeof raw === 'string' ? raw.trim() : ''
  if (!CARD_ID_RE.test(cardId)) throw new ValidationError('card_id の形式が不正です')
  return cardId
}

export interface ReportInput {
  courseId: string
  cardId: string
  /** 報告時点のコース idEpoch（types.ts の Course.idEpoch）。cardId 付け替え事故の事後診断用 */
  idEpoch: number
  headword: string
  reading: string
  gloss: string
  pos: string
  examples: ReportExample[]
  reason: ReportReason
  note: string
}

/** POST /api/reports の本体を検証して正規化する（見えているカードのスナップショットごと受ける） */
export function parseReportInput(raw: unknown): ReportInput {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('リクエスト本体が不正です')
  const o = raw as Record<string, unknown>
  const idEpochRaw = typeof o.idEpoch === 'number' && Number.isFinite(o.idEpoch) ? Math.floor(o.idEpoch) : 1
  const reason =
    typeof o.reason === 'string' && (REPORT_REASONS as readonly string[]).includes(o.reason)
      ? (o.reason as ReportReason)
      : null
  if (!reason) throw new ValidationError('reason の指定が不正です')
  return {
    courseId: parseCourseId(o.courseId),
    cardId: parseAnyCardId(o.cardId),
    idEpoch: Math.min(Math.max(idEpochRaw, 0), 100),
    headword: requiredText(o.headword, 80, '見出し語'),
    reading: cleanText(o.reading, 80),
    gloss: cleanText(o.gloss, 200),
    pos: cleanText(o.pos, 20),
    examples: parseExamples(o.examples),
    reason,
    note: cleanText(o.note, 200),
  }
}

export interface CorrectionInput {
  courseId: string
  cardId: string
  headword: string
  reading: string
  gloss: string
  pos: string
  examples: ReportExample[]
}

/**
 * POST /api/admin/corrections の本体を検証して正規化する。
 * 部分パッチではなくフルセット——管理画面は常に「現在値を複製したフォーム」を編集させるので、
 * 触っていない欄も含めて毎回全部送られてくる前提（ファイル冒頭の設計メモ参照）。
 */
export function parseCorrectionInput(raw: unknown): CorrectionInput {
  if (typeof raw !== 'object' || raw === null) throw new ValidationError('リクエスト本体が不正です')
  const o = raw as Record<string, unknown>
  return {
    courseId: parseCourseId(o.courseId),
    cardId: parseAnyCardId(o.cardId),
    headword: requiredText(o.headword, 80, '見出し語'),
    reading: cleanText(o.reading, 80),
    gloss: requiredText(o.gloss, 200, '訳'),
    pos: cleanText(o.pos, 20),
    examples: parseExamples(o.examples),
  }
}

export function parseReportId(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) throw new ValidationError('id が不正です')
  return n
}

export function parseReportStatus(raw: unknown): ReportStatus {
  if (typeof raw === 'string' && (REPORT_STATUSES as readonly string[]).includes(raw)) return raw as ReportStatus
  throw new ValidationError('status の指定が不正です')
}

/** GET /api/corrections?courseId=... のクエリパラメータを検証する */
export function parseCourseIdParam(raw: string | null): string {
  return parseCourseId(raw ?? '')
}

// ── D1 ──

interface CardReportRow {
  id: number
  at: string
  email: string
  course_id: string
  card_id: string
  id_epoch: number
  headword: string
  reading: string
  gloss: string
  pos: string
  examples: string
  reason: string
  note: string
  status: string
  admin_note: string
  updated_at: string
}

interface CardCorrectionRow {
  card_id: string
  course_id: string
  headword: string
  reading: string
  gloss: string
  pos: string
  examples: string
}

function safeParseExamples(raw: string): ReportExample[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ReportExample[]) : []
  } catch {
    return []
  }
}

async function countTodayReports(env: Env, email: string): Promise<number> {
  const since = startOfTodayIso(new Date())
  const row = await env.DB.prepare(`SELECT COUNT(*) as n FROM card_reports WHERE email = ?1 AND at >= ?2`)
    .bind(email, since)
    .first<{ n: number }>()
  return row?.n ?? 0
}

async function insertReport(env: Env, email: string, input: ReportInput): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO card_reports
       (at, email, course_id, card_id, id_epoch, headword, reading, gloss, pos, examples, reason, note, status, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'open', ?1)`,
  )
    .bind(
      now,
      email,
      input.courseId,
      input.cardId,
      input.idEpoch,
      input.headword,
      input.reading,
      input.gloss,
      input.pos,
      JSON.stringify(input.examples),
      input.reason,
      input.note,
    )
    .run()
}

async function selectReports(env: Env): Promise<CardReportRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, at, email, course_id, card_id, id_epoch, headword, reading, gloss, pos, examples, reason, note, status, admin_note, updated_at
     FROM card_reports ORDER BY id DESC LIMIT 500`,
  ).all<CardReportRow>()
  return results ?? []
}

async function updateReportStatus(env: Env, id: number, status: ReportStatus, adminNote: string): Promise<void> {
  await env.DB.prepare(`UPDATE card_reports SET status = ?2, admin_note = ?3, updated_at = ?4 WHERE id = ?1`)
    .bind(id, status, adminNote, new Date().toISOString())
    .run()
}

/** 完全削除（purge）用。index.ts の handleRemoveUser から呼ぶ */
export async function deleteReportsForUser(env: Env, email: string): Promise<void> {
  await ensureReportsSchema(env)
  await env.DB.prepare(`DELETE FROM card_reports WHERE email = ?1`).bind(email).run()
}

async function upsertCorrectionRow(env: Env, input: CorrectionInput, actorEmail: string): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO card_corrections (card_id, course_id, headword, reading, gloss, pos, examples, updated_at, updated_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(card_id) DO UPDATE SET
       course_id = ?2, headword = ?3, reading = ?4, gloss = ?5, pos = ?6, examples = ?7, updated_at = ?8, updated_by = ?9`,
  )
    .bind(input.cardId, input.courseId, input.headword, input.reading, input.gloss, input.pos, JSON.stringify(input.examples), now, actorEmail)
    .run()
}

async function selectCorrections(env: Env, courseId: string): Promise<CardCorrectionRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT card_id, course_id, headword, reading, gloss, pos, examples FROM card_corrections WHERE course_id = ?1`,
  )
    .bind(courseId)
    .all<CardCorrectionRow>()
  return results ?? []
}

async function deleteCorrectionRow(env: Env, cardId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM card_corrections WHERE card_id = ?1`).bind(cardId).run()
}

async function logAdmin(env: Env, actor: string, action: string, target: string, detail: string): Promise<boolean> {
  try {
    await writeAdminLog(env, actor, action, target, detail)
    return true
  } catch (err) {
    console.error('admin_log の書き込みに失敗:', err)
    return false
  }
}

// ── HTTP 本文読み取り・レスポンス組み立て（index.ts の readJson/json と同じ規則をここでも独立して持つ） ──

const MAX_BODY_BYTES = 64 * 1024

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })
}

async function readJsonBody(request: Request): Promise<unknown> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!type.includes('application/json')) {
    throw new ValidationError('Content-Type は application/json にしてください')
  }
  const body = await request.arrayBuffer()
  if (body.byteLength > MAX_BODY_BYTES) throw new ValidationError('リクエストが大きすぎます')
  try {
    return JSON.parse(new TextDecoder().decode(body))
  } catch {
    throw new ValidationError('JSON として解釈できませんでした')
  }
}

// ── HTTP ハンドラ（index.ts はこれを case から呼ぶだけ。認可は呼び出し側で先に確認済み） ──

/** POST /api/reports。呼び出し側で ensureActiveUser 済みであること */
export async function handleCreateReport(request: Request, env: Env, identity: Identity): Promise<Response> {
  await ensureReportsSchema(env)
  const input = parseReportInput(await readJsonBody(request))
  const count = await countTodayReports(env, identity.email)
  if (count >= REPORT_RATE_LIMIT_PER_DAY) {
    throw new ReportError('本日の報告件数が上限に達しました。また明日お試しください', 429)
  }
  await insertReport(env, identity.email, input)
  return json({ ok: true })
}

/** GET /api/corrections?courseId=... 。呼び出し側で ensureActiveUser 済みであること */
export async function handleGetCorrections(env: Env, url: URL): Promise<Response> {
  await ensureReportsSchema(env)
  const courseId = parseCourseIdParam(url.searchParams.get('courseId'))
  const rows = await selectCorrections(env, courseId)
  return json({
    corrections: rows.map((r) => ({
      cardId: r.card_id,
      headword: r.headword,
      reading: r.reading,
      gloss: r.gloss,
      pos: r.pos,
      examples: safeParseExamples(r.examples),
    })),
  })
}

/** GET /api/admin/reports */
export async function handleListReports(env: Env, identity: Identity): Promise<Response> {
  requireAdmin(identity)
  await ensureReportsSchema(env)
  const rows = await selectReports(env)
  return json({
    reports: rows.map((r) => ({
      id: r.id,
      at: r.at,
      email: r.email,
      courseId: r.course_id,
      cardId: r.card_id,
      idEpoch: r.id_epoch,
      headword: r.headword,
      reading: r.reading,
      gloss: r.gloss,
      pos: r.pos,
      examples: safeParseExamples(r.examples),
      reason: r.reason,
      note: r.note,
      status: r.status,
      adminNote: r.admin_note,
      updatedAt: r.updated_at,
    })),
  })
}

/** POST /api/admin/reports/status。requireAdmin はこの関数自身が呼ぶ */
export async function handleUpdateReportStatus(request: Request, env: Env, identity: Identity): Promise<Response> {
  requireAdmin(identity)
  await ensureReportsSchema(env)
  const body = (await readJsonBody(request)) as Record<string, unknown>
  const id = parseReportId(body.id)
  const status = parseReportStatus(body.status)
  const adminNote = cleanText(body.adminNote, 200)
  await updateReportStatus(env, id, status, adminNote)
  const logged = await logAdmin(env, identity.email, 'update_report_status', String(id), status)
  return json({ ok: true, logged })
}

/** POST /api/admin/corrections。requireAdmin はこの関数自身が呼ぶ */
export async function handleSetCorrection(request: Request, env: Env, identity: Identity): Promise<Response> {
  requireAdmin(identity)
  await ensureReportsSchema(env)
  const input = parseCorrectionInput(await readJsonBody(request))
  await upsertCorrectionRow(env, input, identity.email)
  const logged = await logAdmin(env, identity.email, 'set_correction', input.cardId, input.headword)
  return json({ ok: true, logged })
}

/** POST /api/admin/corrections/delete。requireAdmin はこの関数自身が呼ぶ */
export async function handleDeleteCorrection(request: Request, env: Env, identity: Identity): Promise<Response> {
  requireAdmin(identity)
  await ensureReportsSchema(env)
  const body = (await readJsonBody(request)) as Record<string, unknown>
  const cardId = parseAnyCardId(body.cardId)
  await deleteCorrectionRow(env, cardId)
  const logged = await logAdmin(env, identity.email, 'delete_correction', cardId, '')
  return json({ ok: true, logged })
}
