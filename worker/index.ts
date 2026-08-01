import { AuthError, adminEmails, assertSameOrigin, authenticate, requireAdmin } from './auth'
import { CloudflareError, accessListConfigured, addAccessEmail, listAccessEmails, removeAccessEmail, revokeUserSessions } from './cf'
import {
  createUser,
  ensureSchema,
  getUser,
  listUsersWithProgress,
  markUserRemoved,
  parseAllowedCourses,
  purgeUser,
  recentAdminLog,
  saveProgress,
  touchLastSeen,
  updateAllowedCourses,
  updateUserProfile,
  upsertUser,
  writeAdminLog,
  type UserRow,
} from './store'
import type { AdminUser, Env, Identity } from './types'
import { ValidationError, cleanText, normalizeEmail, parseCourseIdList, parseSyncInput } from './validate'

/**
 * 管理者画面のバックエンド。
 *
 * ルーティングは「/api/* だけ Worker が処理し、それ以外はビルド済み SPA へそのまま委譲」。
 * 静的アセットは従来どおり Worker を経由せず配信されるので（Cloudflare の既定挙動）、
 * 学習画面の表示速度・オフライン動作・存在しない JSON の 404 フォールバックは一切変わらない。
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  // 認証済みの個人データ。CDN・Service Worker・ブラウザのどれにも残さない
  'Cache-Control': 'no-store',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })
}

/** 想定内の失敗を HTTP ステータスに落とす。想定外は 500（詳細は返さずログに残す） */
function errorResponse(err: unknown): Response {
  if (err instanceof AuthError) return json({ error: err.message }, err.status)
  if (err instanceof ValidationError) return json({ error: err.message }, 400)
  if (err instanceof CloudflareError) return json({ error: err.message }, err.status)
  console.error('unhandled API error:', err)
  return json({ error: 'サーバー側でエラーが発生しました' }, 500)
}

const MAX_BODY_BYTES = 64 * 1024

/**
 * 本文の JSON を読む（集計値しか送られてこない前提）。
 * - Content-Type を必須にする：request.json() は Content-Type を見ないため、これが無いと
 *   enctype="text/plain" のクロスサイト・フォーム POST（preflight が起きない）を JSON として受けてしまう。
 * - サイズは content-length ヘッダでなく **実バイト数**で判定する（ヘッダは送らない/壊すだけで無効化できる）。
 */
async function readJson(request: Request): Promise<unknown> {
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // 管理者画面をパスでも開けるようにする（`#admin` は Access のログインを挟むと消えるため）。
    // 末尾スラッシュ付きは正規化する——`/admin/` のままだと相対パスのアセット参照が
    // `/admin/assets/...` に解決されて 404 になる。
    if (url.pathname === '/admin/') {
      return Response.redirect(new URL('/admin', url).toString(), 301)
    }
    if (url.pathname === '/admin') {
      return env.ASSETS.fetch(new Request(new URL('/', url), { headers: request.headers }))
    }

    if (!url.pathname.startsWith('/api/')) {
      // 学習アプリ本体（静的アセット）。挙動は Worker 導入前と同じ
      return env.ASSETS.fetch(request)
    }
    try {
      return await handleApi(request, env, url)
    } catch (err) {
      return errorResponse(err)
    }
  },
} satisfies ExportedHandler<Env>

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  // CSRF：状態を変える要求は同一オリジンからのものだけ。認証より先に落とす
  assertSameOrigin(request, url)
  const identity = await authenticate(request, env)
  await ensureSchema(env)

  const route = `${request.method} ${url.pathname.replace(/\/+$/, '')}`
  switch (route) {
    case 'GET /api/me':
      return await handleMe(env, identity)
    case 'POST /api/sync':
      return await handleSync(request, env, identity)
    case 'GET /api/admin/users':
      return await handleListUsers(env, identity)
    case 'POST /api/admin/users':
      return await handleAddUser(request, env, identity)
    case 'PATCH /api/admin/users':
      return await handleUpdateUser(request, env, identity)
    // 削除はメールをクエリでなく本文で受ける（クエリだと Workers Logs の
    // invocation log に URL ごと残り、消したはずの人のメールがログに残るため）
    case 'POST /api/admin/users/remove':
      return await handleRemoveUser(request, env, identity)
    case 'GET /api/admin/log':
      requireAdmin(identity)
      return json({ entries: await recentAdminLog(env) })
    default:
      return json({ error: 'そのようなエンドポイントはありません' }, 404)
  }
}

/**
 * 名簿の行を返す。無ければ「いま Access の許可リストに載っている人」だけ自動登録する。
 *
 * 無条件に作ると、完全削除（purge）した人の Access セッションが生きている間に
 * その端末の自動同期で行が作り直され、消したはずの利用者が active で復活してしまう
 * （セッション失効はベストエフォートなので、失敗すればセッション有効期間ぶんの窓が開く）。
 */
async function ensureRegistered(env: Env, identity: Identity): Promise<UserRow | null> {
  const existing = await getUser(env, identity.email)
  if (existing) {
    await touchLastSeen(env, identity.email)
    return existing
  }
  // 管理者は ADMIN_EMAILS（管理者本人しか変更できない）で定義されるので常に登録してよい。
  // Cloudflare 連携が未設定の間は従来どおり作る（許可リストを参照できないため）。
  let allowed = identity.isAdmin || !accessListConfigured(env)
  if (!allowed) {
    try {
      allowed = (await listAccessEmails(env)).includes(identity.email)
    } catch {
      // 許可リストを確認できないときは作らない（復活させない側に倒す）
      allowed = false
    }
  }
  if (!allowed) return null
  await createUser(env, identity.email)
  return await getUser(env, identity.email)
}

/** 自分が誰か（管理画面の入口・端末側の表示名同期に使う） */
async function handleMe(env: Env, identity: Identity): Promise<Response> {
  const user = await ensureRegistered(env, identity)
  return json({
    email: identity.email,
    isAdmin: identity.isAdmin,
    status: user ? user.status : 'unregistered',
    displayName: user?.display_name ?? '',
    // null＝制限なし。端末側はこれで学習画面のコース一覧を絞る
    allowedCourses: parseAllowedCourses(user?.allowed_courses),
  })
}

/**
 * 端末からコース別の集計値を受け取る。
 * サーバー側が持つ表示名を返し、端末はそれを自分の表示名として保存する
 * ＝表示名の登録・変更は管理画面だけで行える（端末側に編集 UI を作らない）。
 */
async function handleSync(request: Request, env: Env, identity: Identity): Promise<Response> {
  const user = await ensureRegistered(env, identity)
  if (!user || user.status !== 'active') {
    // 許可リストから消しても既存セッションはしばらく生きる。その間の書き込みは受けない
    return json({ error: 'このアカウントは利用停止されています' }, 403)
  }
  const input = parseSyncInput(await readJson(request))
  await saveProgress(env, identity.email, input.courses)
  return json({
    ok: true,
    displayName: user.display_name,
    allowedCourses: parseAllowedCourses(user.allowed_courses),
  })
}

/** 名簿＋進捗＋Access 許可リストとの突き合わせ */
async function handleListUsers(env: Env, identity: Identity): Promise<Response> {
  requireAdmin(identity)
  const rows = await listUsersWithProgress(env)

  // 許可リストの取得に失敗しても一覧自体は出す（設定前でも進捗確認はできるように）
  let accessEmails: Set<string> | null = null
  let accessListError: string | null = null
  if (accessListConfigured(env)) {
    try {
      accessEmails = new Set(await listAccessEmails(env))
    } catch (err) {
      accessListError = err instanceof Error ? err.message : String(err)
    }
  } else {
    accessListError = 'Cloudflare 連携が未設定です（登録・削除はまだ使えません）'
  }

  const admins = adminEmails(env)
  const users: Array<AdminUser & { isAdmin: boolean }> = rows.map(({ user, courses }) => ({
    email: user.email,
    displayName: user.display_name,
    note: user.note,
    status: user.status === 'removed' ? 'removed' : 'active',
    createdAt: user.created_at,
    lastSeenAt: user.last_seen_at,
    inAccessList: accessEmails ? accessEmails.has(user.email) : null,
    isAdmin: admins.has(user.email),
    allowedCourses: parseAllowedCourses(user.allowed_courses),
    courses,
  }))

  // 許可リストにだけ居て名簿に無いメール（ダッシュボードで直接足した人）も見せる
  const known = new Set(users.map((u) => u.email))
  const unregistered = accessEmails ? [...accessEmails].filter((e) => !known.has(e)) : []

  return json({ users, unregistered, accessListError, canManageAccess: accessListConfigured(env) })
}

async function handleAddUser(request: Request, env: Env, identity: Identity): Promise<Response> {
  requireAdmin(identity)
  const body = (await readJson(request)) as Record<string, unknown>
  const email = normalizeEmail(body.email)
  const displayName = cleanText(body.displayName, 60)
  const note = cleanText(body.note, 200)

  // ①ログイン許可（＝実体）を先に。失敗したら名簿も作らない
  //   ——「名簿にはいるのにログインできない」ずれを作らないため
  await addAccessEmail(env, email, displayName || 'Vocab Trainer')
  // ②名簿を更新（removed だった人はここで active に戻る）
  await upsertUser(env, email, displayName, note)
  const logged = await writeLog(env, identity.email, 'add_user', email, displayName)

  return json({ ok: true, email, logged })
}

async function handleUpdateUser(request: Request, env: Env, identity: Identity): Promise<Response> {
  requireAdmin(identity)
  const body = (await readJson(request)) as Record<string, unknown>
  const email = normalizeEmail(body.email)
  const current = await getUser(env, email)
  if (!current) return json({ error: '名簿にいません' }, 404)
  // 送られてきたキーだけを更新する。コース割り当てだけを変えたいときに
  // 表示名やメモが空で上書きされないようにするため（既存値をそのまま残す）。
  const displayName = 'displayName' in body ? cleanText(body.displayName, 60) : current.display_name
  const note = 'note' in body ? cleanText(body.note, 200) : current.note
  await updateUserProfile(env, email, displayName, note)
  // allowedCourses はキーが来たときだけ触る（表示名だけの更新でコース割り当てを消さない）
  let detail = displayName
  if ('allowedCourses' in body) {
    const courseIds = parseCourseIdList(body.allowedCourses)
    await updateAllowedCourses(env, email, courseIds)
    detail = courseIds.length > 0 ? `courses=${courseIds.join('|')}` : 'courses=all'
  }
  const logged = await writeLog(env, identity.email, 'update_user', email, detail)
  return json({ ok: true, logged })
}

/**
 * 削除＝ログイン許可の取り消し。
 * 既定では進捗を残す（誤削除からの復帰・再登録で履歴が戻る）。purge:true で完全削除。
 */
async function handleRemoveUser(request: Request, env: Env, identity: Identity): Promise<Response> {
  requireAdmin(identity)
  const body = (await readJson(request)) as Record<string, unknown>
  const email = normalizeEmail(body.email)
  const purge = body.purge === true

  // 自分自身・他の管理者を締め出すと管理画面へ入れなくなる（復旧は Cloudflare ダッシュボード）。
  // 事故のコストが大きいわりに得るものが無いので機械的に止める。
  if (email === identity.email) return json({ error: '自分自身は削除できません' }, 400)
  if (adminEmails(env).has(email)) {
    return json({ error: '管理者は管理画面から削除できません（ADMIN_EMAILS を変更してください）' }, 400)
  }

  await removeAccessEmail(env, email)
  const sessionRevoked = await revokeUserSessions(env, email)
  if (purge) await purgeUser(env, email)
  else await markUserRemoved(env, email)
  const logged = await writeLog(
    env,
    identity.email,
    purge ? 'purge_user' : 'remove_user',
    email,
    sessionRevoked ? '' : 'session-revoke-failed',
  )

  return json({ ok: true, sessionRevoked, logged })
}

/**
 * 監査ログの失敗で本処理を巻き戻さない（記録できないことより操作が通ることを優先）。
 * ただし admin_log は取り返しのつかない管理操作の唯一の記録なので、
 * 書けなかったことは false で呼び出し元に返し、管理画面に出す。
 */
async function writeLog(env: Env, actor: string, action: string, target: string, detail: string): Promise<boolean> {
  try {
    await writeAdminLog(env, actor, action, target, detail)
    return true
  } catch (err) {
    console.error('admin_log の書き込みに失敗:', err)
    return false
  }
}
