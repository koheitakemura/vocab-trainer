import { requireAdmin } from './auth'
import { getUser, parseAllowedCourses, writeAdminLog, type UserRow } from './store'
import { ValidationError } from './validate'
import type { Env, Identity } from './types'

/**
 * コース利用リクエスト（未割当コースのプレビュー画面から「利用したい」を送る機能）。
 *
 * このモジュールは reports.ts と同じ理由で自己完結させている——D1スキーマ・検証・JSON組み立てを
 * 自前で持ち、index.ts 側は各ハンドラを呼ぶだけの薄いルーティングにする（並行編集時の衝突面を
 * 減らすため。parallel-session-collision-check メモリの方針）。一般利用者向け（送信）は
 * index.ts が ensureActiveUser を先に呼んでから委譲する（index.ts の private 関数を
 * ここから import できないため）。管理者向け2件は requireAdmin を各ハンドラ自身が呼ぶ。
 *
 * course_requests は「誰が・いつ・どのコースを・pending/approved/dismissed のどれか」だけを持つ。
 * 承認時に users.allowed_courses へ実際に追加するのは addAllowedCourse（このファイル内）——
 * JS 側の read→write ではなく1文の UPDATE で原子的に行う（同時に複数コースが承認される
 * レースで片方が消えるのを防ぐため）。同一 email+course_id の pending 二重作成は
 * 部分ユニークインデックスで DB 側に保証させる（連打・複数タブでも1行しかできない）。
 */

// ── D1 スキーマ（store.ts の SCHEMA には入れない。ensureSchema と衝突しない独立管理） ──

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS course_requests (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     at          TEXT NOT NULL,
     email       TEXT NOT NULL,
     course_id   TEXT NOT NULL,
     status      TEXT NOT NULL DEFAULT 'pending',
     resolved_at TEXT,
     resolved_by TEXT NOT NULL DEFAULT '',
     updated_at  TEXT NOT NULL
   )`,
  // countTodayRequests の WHERE email=? AND at>=? を全表スキャンにしない（word_gen_log と同じ理由）
  `CREATE INDEX IF NOT EXISTS idx_course_requests_rate ON course_requests(email, at)`,
  // 同じ人が同じコースを pending 中に連打しても DB 側で1行しか作れない（idempotency の実体）。
  // WHERE status='pending' 限定の部分インデックスなので、過去に却下/承認済みでも再リクエストできる。
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_course_requests_pending ON course_requests(email, course_id) WHERE status = 'pending'`,
]

let schemaReady = false

async function ensureCourseRequestsSchema(env: Env): Promise<void> {
  if (schemaReady) return
  await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)))
  schemaReady = true
}

/** 1人1日のリクエスト上限。idempotency で正規利用は数件しか積まれないので、これは不正なコールへの保険 */
export const COURSE_REQUEST_RATE_LIMIT_PER_DAY = 20

export class CourseRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'CourseRequestError'
  }
}

// ── 検証 ──

const COURSE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

function parseCourseId(raw: unknown): string {
  const courseId = typeof raw === 'string' ? raw.trim() : ''
  if (!COURSE_ID_RE.test(courseId)) throw new ValidationError('コースIDの形式が不正です')
  return courseId
}

export function parseCourseRequestId(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) throw new ValidationError('id が不正です')
  return n
}

const RESOLVE_ACTIONS = ['approve', 'dismiss'] as const
export type ResolveAction = (typeof RESOLVE_ACTIONS)[number]

export function parseResolveAction(raw: unknown): ResolveAction {
  if (typeof raw === 'string' && (RESOLVE_ACTIONS as readonly string[]).includes(raw)) return raw as ResolveAction
  throw new ValidationError('action の指定が不正です')
}

// ── D1 ──

interface CourseRequestRow {
  id: number
  at: string
  email: string
  course_id: string
  status: string
  resolved_at: string | null
  resolved_by: string
  updated_at: string
}

async function countTodayRequests(env: Env, email: string): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const row = await env.DB.prepare(`SELECT COUNT(*) as n FROM course_requests WHERE email = ?1 AND at >= ?2`)
    .bind(email, since.toISOString())
    .first<{ n: number }>()
  return row?.n ?? 0
}

/**
 * users.allowed_courses に courseId を1件追加する。**JS の read→write ではなく1文の UPDATE**——
 * 同時に別のリクエストが承認されても互いの追加を消し合わない（レース対策）。
 * 無制限（allowed_courses = ''）のユーザーはそのまま無制限を維持する（1コースに狭めない）。
 */
async function addAllowedCourse(env: Env, email: string, courseId: string): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `UPDATE users SET
       allowed_courses = CASE
         WHEN allowed_courses = '' THEN allowed_courses
         WHEN ','||allowed_courses||',' LIKE '%,'||?2||',%' THEN allowed_courses
         ELSE allowed_courses || ',' || ?2
       END,
       updated_at = ?3
     WHERE email = ?1`,
  )
    .bind(email, courseId, now)
    .run()
}

async function insertRequest(env: Env, email: string, courseId: string): Promise<boolean> {
  const now = new Date().toISOString()
  const res = await env.DB.prepare(
    `INSERT INTO course_requests (at, email, course_id, status, updated_at)
     VALUES (?1, ?2, ?3, 'pending', ?1)
     ON CONFLICT(email, course_id) WHERE status = 'pending' DO NOTHING`,
  )
    .bind(now, email, courseId)
    .run()
  return (res.meta.changes ?? 0) > 0
}

/** 完全削除（purge）用。index.ts の handleRemoveUser から呼ぶ（reports.ts の deleteReportsForUser と同じ理由——
 *  course_requests は email を含むPIIなので、他のテーブル同様ここで確実に消す） */
export async function deleteCourseRequestsForUser(env: Env, email: string): Promise<void> {
  await ensureCourseRequestsSchema(env)
  await env.DB.prepare(`DELETE FROM course_requests WHERE email = ?1`).bind(email).run()
}

async function selectRequests(env: Env): Promise<CourseRequestRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, at, email, course_id, status, resolved_at, resolved_by, updated_at
     FROM course_requests ORDER BY (status = 'pending') DESC, id DESC LIMIT 300`,
  ).all<CourseRequestRow>()
  return results ?? []
}

async function getRequest(env: Env, id: number): Promise<CourseRequestRow | null> {
  return await env.DB.prepare(
    `SELECT id, at, email, course_id, status, resolved_at, resolved_by, updated_at FROM course_requests WHERE id = ?1`,
  )
    .bind(id)
    .first<CourseRequestRow>()
}

async function resolveRequestRow(env: Env, id: number, status: ResolveAction, actorEmail: string): Promise<void> {
  const resolvedStatus = status === 'approve' ? 'approved' : 'dismissed'
  const now = new Date().toISOString()
  await env.DB.prepare(
    `UPDATE course_requests SET status = ?2, resolved_at = ?3, resolved_by = ?4, updated_at = ?3 WHERE id = ?1`,
  )
    .bind(id, resolvedStatus, now, actorEmail)
    .run()
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

// ── HTTP 本文読み取り・レスポンス組み立て（reports.ts と同じ規則をここでも独立して持つ） ──

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

/** POST /api/course-requests。呼び出し側で ensureActiveUser 済みであること（user はその戻り値） */
export async function handleCreateCourseRequest(
  request: Request,
  env: Env,
  identity: Identity,
  user: UserRow,
): Promise<Response> {
  await ensureCourseRequestsSchema(env)
  const body = (await readJsonBody(request)) as Record<string, unknown>
  const courseId = parseCourseId(body.courseId)

  // クライアントの allowedCourses キャッシュが古いまま「リクエスト」を押すケース
  // （直近で承認済みだが同期がまだ届いていない）はリクエストを作らず素直に伝える。
  const allowed = parseAllowedCourses(user.allowed_courses)
  if (!allowed || allowed.includes(courseId)) {
    return json({ ok: true, alreadyGranted: true })
  }

  const count = await countTodayRequests(env, identity.email)
  if (count >= COURSE_REQUEST_RATE_LIMIT_PER_DAY) {
    throw new CourseRequestError('本日のリクエスト件数が上限に達しました。また明日お試しください', 429)
  }

  const inserted = await insertRequest(env, identity.email, courseId)
  return json({ ok: true, alreadyRequested: !inserted })
}

/** GET /api/admin/course-requests */
export async function handleListCourseRequests(env: Env, identity: Identity): Promise<Response> {
  requireAdmin(identity)
  await ensureCourseRequestsSchema(env)
  const rows = await selectRequests(env)
  return json({
    requests: rows.map((r) => ({
      id: r.id,
      at: r.at,
      email: r.email,
      courseId: r.course_id,
      status: r.status,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
    })),
  })
}

/** POST /api/admin/course-requests/resolve。requireAdmin はこの関数自身が呼ぶ */
export async function handleResolveCourseRequest(request: Request, env: Env, identity: Identity): Promise<Response> {
  requireAdmin(identity)
  await ensureCourseRequestsSchema(env)
  const body = (await readJsonBody(request)) as Record<string, unknown>
  const id = parseCourseRequestId(body.id)
  const action = parseResolveAction(body.action)

  const row = await getRequest(env, id)
  if (!row) return json({ error: 'そのリクエストは見つかりません' }, 404)
  if (row.status !== 'pending') return json({ ok: true, alreadyResolved: true })

  if (action === 'approve') {
    const targetUser = await getUser(env, row.email)
    if (targetUser) await addAllowedCourse(env, row.email, row.course_id)
  }
  await resolveRequestRow(env, id, action, identity.email)
  const logged = await logAdmin(
    env,
    identity.email,
    action === 'approve' ? 'approve_course_request' : 'dismiss_course_request',
    row.email,
    row.course_id,
  )
  return json({ ok: true, logged })
}
