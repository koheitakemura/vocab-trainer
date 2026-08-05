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
  // 検索して見つからない語をAI生成したときのキャッシュ（docs/word-request-design.md §7・§9）。
  // 同じ語を別の人が引いたときはここを引くだけで済む＝AI呼び出しは語1件につき最大1回。
  `CREATE TABLE IF NOT EXISTS extra_cards (
     card_id     TEXT PRIMARY KEY,
     course_id   TEXT NOT NULL,
     content_key TEXT NOT NULL,
     payload     TEXT NOT NULL,
     model       TEXT NOT NULL,
     created_at  TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_extra_cards_lookup ON extra_cards(course_id, content_key)`,
  // 生成試行のログ。監査（誰が何を生成/却下したか）とレート制限（1日20語）の分母を兼ねる
  `CREATE TABLE IF NOT EXISTS word_gen_log (
     id        INTEGER PRIMARY KEY AUTOINCREMENT,
     at        TEXT NOT NULL,
     email     TEXT NOT NULL,
     course_id TEXT NOT NULL,
     headword  TEXT NOT NULL,
     result    TEXT NOT NULL,
     model     TEXT NOT NULL DEFAULT '',
     detail    TEXT NOT NULL DEFAULT ''
   )`,
  // countTodayGenerations/countTodayReuses の WHERE email=? AND at>=? を全表スキャンにしないため
  // （security-reviewer 指摘。テーブルが育つほど毎リクエストの読み取り行数と遅延が悪化していた）。
  // ※ word_gen_log の CREATE TABLE より後に置くこと（CREATE INDEX は対象テーブルが
  //   既に存在しないと SQLITE_ERROR になる。batch() は配列順に1トランザクションで実行される）。
  `CREATE INDEX IF NOT EXISTS idx_word_gen_log_rate ON word_gen_log(email, at)`,
  // 機能全体のキルスイッチ等、小さな設定値の汎用置き場（autonomous-agent-safety の7点セット #6）
  `CREATE TABLE IF NOT EXISTS app_settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
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
const ADD_COLUMNS = [
  `ALTER TABLE users ADD COLUMN allowed_courses TEXT NOT NULL DEFAULT ''`,
  // 管理画面（Phase 4）の「昇格」＝次回のコース本体ビルドに回す候補として印を付けるだけの
  // フラグ。実際にパイプラインへ取り込む作業自体はここでは行わない（`promoted=1` を
  // pipeline 側が後から拾う想定・docs/word-request-design.md §8）。
  `ALTER TABLE extra_cards ADD COLUMN promoted INTEGER NOT NULL DEFAULT 0`,
]

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

/**
 * 最終アクセス時刻を更新し、更新後の行を返す。**行が無ければ何も起きず null**（作らない）。
 *
 * 以前は getUser（SELECT）→ touchLastSeen（UPDATE）の2往復だった。認証が要る API は
 * すべて ensureRegistered を通るので、この2往復が全リクエストに乗っていた。
 * RETURNING で1往復にまとめる（D1 の往復1回ぶん＝10〜30ms を全 API から削る）。
 * 返るのは更新後の行だが、呼び出し側が見るのは status / display_name / allowed_courses
 * だけで last_seen_at は使わないため、意味論は変わらない。
 */
export async function touchAndGetUser(env: Env, email: string): Promise<UserRow | null> {
  return await env.DB.prepare(`UPDATE users SET last_seen_at = ?2 WHERE email = ?1 RETURNING *`)
    .bind(email, new Date().toISOString())
    .first<UserRow>()
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

/** 名簿と進捗を完全に削除（取り消し不可）。word_gen_log は行動ログ（見出し語検索履歴）を
 *  含むPIIなので、他のテーブル同様ここで必ず消す（security-reviewer 指摘：新設テーブルの
 *  追加で「完全削除」の約束が静かに破られていた）。 */
export async function purgeUser(env: Env, email: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM course_progress WHERE email = ?1`).bind(email),
    env.DB.prepare(`DELETE FROM word_gen_log WHERE email = ?1`).bind(email),
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

/* ── 単語追加リクエスト（管理画面 Phase 4・docs/word-request-design.md §8）
 * 「誰がどのコースに何語追加したか」は word_gen_log（試行ログ）、
 * 「生成物の中身」は extra_cards（カードのキャッシュ）が持つ。両者に owner 列で
 * 紐付けはしていない（Phase 3 の設計判断：所有はクライアント IndexedDB 側で解決済み）ため、
 * course_id + 見出し語（小文字化）で JS 側に組み立てる。 */

export interface ExtraCardRow {
  card_id: string
  course_id: string
  content_key: string
  payload: string
  model: string
  created_at: string
  promoted: number
}

export interface WordGenLogRow {
  at: string
  email: string
  course_id: string
  headword: string
  result: string
  detail: string
}

/**
 * 生成済みカード一覧＋それぞれに紐づく依頼者（reused/generated のログ）＋却下・失敗した試行。
 * 件数が実用上あり得ない規模にならないよう上限を切る（無限に育つログの全件表示はしない）。
 */
export async function listWordRequests(
  env: Env,
): Promise<{ cards: ExtraCardRow[]; requestsByCard: Map<string, WordGenLogRow[]>; failures: WordGenLogRow[] }> {
  const [cardsRes, logRes] = await env.DB.batch<ExtraCardRow | WordGenLogRow>([
    env.DB.prepare(
      `SELECT card_id, course_id, content_key, payload, model, created_at, promoted
       FROM extra_cards ORDER BY created_at DESC LIMIT 300`,
    ),
    env.DB.prepare(
      `SELECT at, email, course_id, headword, result, detail FROM word_gen_log ORDER BY id DESC LIMIT 1000`,
    ),
  ])
  const cards = (cardsRes.results ?? []) as ExtraCardRow[]
  const logs = (logRes.results ?? []) as WordGenLogRow[]

  const requestsByCard = new Map<string, WordGenLogRow[]>()
  const failures: WordGenLogRow[] = []
  for (const log of logs) {
    if (log.result === 'reused' || log.result === 'generated') {
      const key = `${log.course_id}::${log.headword.trim().toLowerCase()}`
      const list = requestsByCard.get(key) ?? []
      list.push(log)
      requestsByCard.set(key, list)
    } else {
      failures.push(log)
    }
  }
  return { cards, requestsByCard, failures: failures.slice(0, 100) }
}

/** 「昇格」＝次回のコース本体ビルドに回す候補フラグを立て/下ろす */
export async function setExtraCardPromoted(env: Env, cardId: string, promoted: boolean): Promise<void> {
  await env.DB.prepare(`UPDATE extra_cards SET promoted = ?2 WHERE card_id = ?1`)
    .bind(cardId, promoted ? 1 : 0)
    .run()
}

/** 生成カードを削除する（次に誰かがこの語を引くと再生成される。word_gen_log は監査ログなので残す） */
export async function deleteExtraCard(env: Env, cardId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM extra_cards WHERE card_id = ?1`).bind(cardId).run()
}
