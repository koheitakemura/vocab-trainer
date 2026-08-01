import type { CourseProgressInput, Env } from './types'

/**
 * D1（名簿・進捗サマリ・操作ログ）への読み書き。
 *
 * 保存するのは**コース別の集計値だけ**（語ごとの学習データ・例文・回答履歴は送らない）。
 * 端末の IndexedDB が引き続き学習の一次データで、ここはその要約のミラー
 * ＝ D1 が消えても学習は 1 ミリも壊れない、という関係を保つ。
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     email        TEXT PRIMARY KEY,
     display_name TEXT NOT NULL DEFAULT '',
     note         TEXT NOT NULL DEFAULT '',
     status       TEXT NOT NULL DEFAULT 'active',
     created_at   TEXT NOT NULL,
     updated_at   TEXT NOT NULL,
     last_seen_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS course_progress (
     email             TEXT NOT NULL,
     course_id         TEXT NOT NULL,
     started           INTEGER NOT NULL DEFAULT 0,
     known             INTEGER NOT NULL DEFAULT 0,
     mastered          INTEGER NOT NULL DEFAULT 0,
     reviews           INTEGER NOT NULL DEFAULT 0,
     days_studied      INTEGER NOT NULL DEFAULT 0,
     streak            INTEGER NOT NULL DEFAULT 0,
     longest_streak    INTEGER NOT NULL DEFAULT 0,
     last_studied_date TEXT,
     updated_at        TEXT NOT NULL,
     PRIMARY KEY (email, course_id)
   )`,
  // 「誰がいつ誰を追加/削除したか」。管理操作は取り返しが付きにくいので必ず残す
  `CREATE TABLE IF NOT EXISTS admin_log (
     id     INTEGER PRIMARY KEY AUTOINCREMENT,
     at     TEXT NOT NULL,
     actor  TEXT NOT NULL,
     action TEXT NOT NULL,
     target TEXT NOT NULL,
     detail TEXT NOT NULL DEFAULT ''
   )`,
]

// isolate 内で 1 回だけ流す。CREATE TABLE IF NOT EXISTS なので何度実行しても安全
// （マイグレーション CLI を必須にしないぶん、D1 を作ってバインドするだけで動き始める）。
let schemaReady = false

/**
 * 既存テーブルへの列追加は CREATE TABLE IF NOT EXISTS では起きないので個別に流す。
 * 既に列があれば "duplicate column name" で失敗するだけなので握りつぶす
 *（マイグレーション CLI を持ち込まずに、後から列を足せるようにするための最小の仕組み）。
 */
const ADD_COLUMNS = [`ALTER TABLE users ADD COLUMN allowed_courses TEXT NOT NULL DEFAULT ''`]

export async function ensureSchema(env: Env): Promise<void> {
  if (schemaReady) return
  await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)))
  for (const sql of ADD_COLUMNS) {
    try {
      await env.DB.prepare(sql).run()
    } catch {
      // 既に存在する＝正常
    }
  }
  schemaReady = true
}

export interface UserRow {
  email: string
  display_name: string
  note: string
  status: string
  created_at: string
  updated_at: string
  last_seen_at: string | null
  /**
   * その人が使えるコース ID をカンマ区切りで持つ。**空文字＝制限なし（全コース）**。
   * 学習画面のコース一覧をこれで絞る。あくまで表示上の絞り込みで、セキュリティ境界ではない
   *（語彙データは Access 配下の静的ファイルなので、URL を知っていれば取得はできる）。
   */
  allowed_courses: string
}

/** 'a,b' 形式の保存値を配列に。空なら null（＝制限なし） */
export function parseAllowedCourses(raw: string | null | undefined): string[] | null {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : null
}

interface ProgressRow {
  email: string
  course_id: string
  started: number
  known: number
  mastered: number
  reviews: number
  days_studied: number
  streak: number
  longest_streak: number
  last_studied_date: string | null
}

/**
 * 名簿に行を作る（初回ログインの自動登録用）。既にあれば何もしない
 * ＝ removed の人をここで active に復活させない（削除の意思を上書きしない）。
 *
 * ⚠️ 「行が無ければ作る」を無条件にやってはいけない。完全削除（purge）した人の Access セッションが
 * まだ生きていると、その端末の自動同期で行が作り直され、消したはずの利用者が active で復活する。
 * 呼ぶ前に必ず「いま Access の許可リストに載っているか」を確かめること（index.ts の ensureRegistered）。
 */
export async function createUser(env: Env, email: string): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO users (email, created_at, updated_at, last_seen_at)
     VALUES (?1, ?2, ?2, ?2)
     ON CONFLICT(email) DO NOTHING`,
  )
    .bind(email, now)
    .run()
}

/** 最終アクセス時刻だけ更新する。**行が無ければ何も起きない**（作らない） */
export async function touchLastSeen(env: Env, email: string): Promise<void> {
  await env.DB.prepare(`UPDATE users SET last_seen_at = ?2 WHERE email = ?1`)
    .bind(email, new Date().toISOString())
    .run()
}

export async function getUser(env: Env, email: string): Promise<UserRow | null> {
  return await env.DB.prepare(`SELECT * FROM users WHERE email = ?1`).bind(email).first<UserRow>()
}

/** 名簿＋進捗を全件返す（管理画面の一覧用。利用者は多くて数十人の想定） */
export async function listUsersWithProgress(
  env: Env,
): Promise<Array<{ user: UserRow; courses: CourseProgressInput[] }>> {
  const [users, progress] = await env.DB.batch<UserRow | ProgressRow>([
    env.DB.prepare(`SELECT * FROM users ORDER BY status ASC, display_name ASC, email ASC`),
    env.DB.prepare(`SELECT * FROM course_progress`),
  ])

  const byEmail = new Map<string, CourseProgressInput[]>()
  for (const r of (progress.results ?? []) as ProgressRow[]) {
    const list = byEmail.get(r.email) ?? []
    list.push({
      courseId: r.course_id,
      started: r.started,
      known: r.known,
      mastered: r.mastered,
      reviews: r.reviews,
      daysStudied: r.days_studied,
      streak: r.streak,
      longestStreak: r.longest_streak,
      lastStudiedDate: r.last_studied_date,
    })
    byEmail.set(r.email, list)
  }

  return ((users.results ?? []) as UserRow[]).map((user) => ({
    user,
    // 進捗の多いコース順＝その人が主に何をやっているかが一目で分かる
    courses: (byEmail.get(user.email) ?? []).sort((a, b) => b.started - a.started),
  }))
}

/** 端末から届いた集計値でコース別進捗を上書きする（端末が常に真＝マージしない） */
export async function saveProgress(env: Env, email: string, courses: CourseProgressInput[]): Promise<void> {
  if (courses.length === 0) return
  const now = new Date().toISOString()
  await env.DB.batch(
    courses.map((c) =>
      env.DB
        .prepare(
          `INSERT INTO course_progress
             (email, course_id, started, known, mastered, reviews, days_studied, streak, longest_streak, last_studied_date, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
           ON CONFLICT(email, course_id) DO UPDATE SET
             started = ?3, known = ?4, mastered = ?5, reviews = ?6, days_studied = ?7,
             streak = ?8, longest_streak = ?9, last_studied_date = ?10, updated_at = ?11`,
        )
        .bind(
          email,
          c.courseId,
          c.started,
          c.known,
          c.mastered,
          c.reviews,
          c.daysStudied,
          c.streak,
          c.longestStreak,
          c.lastStudiedDate,
          now,
        ),
    ),
  )
}

/** 名簿へ登録（既にいれば active に戻して表示名・メモを更新） */
export async function upsertUser(
  env: Env,
  email: string,
  displayName: string,
  note: string,
): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO users (email, display_name, note, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'active', ?4, ?4)
     ON CONFLICT(email) DO UPDATE SET
       display_name = ?2, note = ?3, status = 'active', updated_at = ?4`,
  )
    .bind(email, displayName, note, now)
    .run()
}

/** 表示名・メモだけを更新（ログイン許可には触れない） */
export async function updateUserProfile(
  env: Env,
  email: string,
  displayName: string,
  note: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE users SET display_name = ?2, note = ?3, updated_at = ?4 WHERE email = ?1`,
  )
    .bind(email, displayName, note, new Date().toISOString())
    .run()
}

/** 使えるコースを設定する。空配列＝制限なし（全コース） */
export async function updateAllowedCourses(env: Env, email: string, courseIds: string[]): Promise<void> {
  await env.DB.prepare(`UPDATE users SET allowed_courses = ?2, updated_at = ?3 WHERE email = ?1`)
    .bind(email, courseIds.join(','), new Date().toISOString())
    .run()
}

/** アクセス取り消し（進捗は残す＝再登録すれば履歴が戻る） */
export async function markUserRemoved(env: Env, email: string): Promise<void> {
  await env.DB.prepare(`UPDATE users SET status = 'removed', updated_at = ?2 WHERE email = ?1`)
    .bind(email, new Date().toISOString())
    .run()
}

/** 名簿と進捗を完全に削除（取り消し不可） */
export async function purgeUser(env: Env, email: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM course_progress WHERE email = ?1`).bind(email),
    env.DB.prepare(`DELETE FROM users WHERE email = ?1`).bind(email),
  ])
}

export async function writeAdminLog(
  env: Env,
  actor: string,
  action: string,
  target: string,
  detail = '',
): Promise<void> {
  await env.DB.prepare(`INSERT INTO admin_log (at, actor, action, target, detail) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(new Date().toISOString(), actor, action, target, detail)
    .run()
}

export interface AdminLogRow {
  at: string
  actor: string
  action: string
  target: string
  detail: string
}

/** 直近の管理操作（管理画面の下部に出す） */
export async function recentAdminLog(env: Env, limit = 20): Promise<AdminLogRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT at, actor, action, target, detail FROM admin_log ORDER BY id DESC LIMIT ?1`,
  )
    .bind(Math.min(Math.max(limit, 1), 100))
    .all<AdminLogRow>()
  return results ?? []
}
