import { apiUrl } from '../../store/sync'

/**
 * 管理者画面が使う API クライアント。
 * 認証情報は一切持たない——ログインは Cloudflare Access が済ませており、
 * ブラウザが自動で付ける Access の Cookie/ヘッダをそのまま使う（same-origin 固定）。
 */

export interface AdminCourseProgress {
  courseId: string
  started: number
  known: number
  mastered: number
  reviews: number
  daysStudied: number
  streak: number
  longestStreak: number
  lastStudiedDate: string | null
}

export interface AdminUser {
  email: string
  displayName: string
  note: string
  status: 'active' | 'removed'
  createdAt: string
  lastSeenAt: string | null
  /** Cloudflare Access の許可リストに実際に載っているか（null＝リストを取得できなかった） */
  inAccessList: boolean | null
  isAdmin: boolean
  /** その人が使えるコース ID。**null＝制限なし（全コース）** */
  allowedCourses: string[] | null
  courses: AdminCourseProgress[]
}

export interface UsersResponse {
  users: AdminUser[]
  /** 許可リストにはあるが名簿に無いメール（ダッシュボードで直接追加された人） */
  unregistered: string[]
  accessListError: string | null
  canManageAccess: boolean
}

export interface Me {
  email: string
  isAdmin: boolean
  /** unregistered＝Access は通ったが名簿に行が無い（完全削除された等） */
  status: 'active' | 'removed' | 'unregistered'
  displayName: string
}

/** 変更系 API の共通の戻り。logged=false は「操作は成功したが監査ログに残せなかった」 */
export interface MutationResult {
  ok: true
  logged: boolean
}

export interface AdminLogEntry {
  at: string
  actor: string
  action: string
  target: string
  detail: string
}

export interface WordRequestExample {
  text: string
  translation: string
}

/** AI が生成した単語カード1件（docs/word-request-design.md §8。管理画面「単語追加リクエスト」） */
export interface WordRequestCard {
  cardId: string
  courseId: string
  headword: string
  gloss: string
  pos: string
  examples: WordRequestExample[]
  model: string
  createdAt: string
  /** 次回のコース本体ビルドに回す候補として印を付けたか */
  promoted: boolean
  requesters: { email: string; at: string; result: string }[]
}

/** 却下・失敗した生成試行（カードにならなかったもの） */
export interface WordRequestFailure {
  at: string
  email: string
  courseId: string
  headword: string
  result: string
  detail: string
}

export interface WordRequestsResponse {
  cards: WordRequestCard[]
  failures: WordRequestFailure[]
}

/** サーバーが返したメッセージをそのまま持つエラー（画面にそのまま出して原因を分かるようにする） */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(apiUrl(path), { credentials: 'same-origin', ...init })
  } catch {
    throw new ApiError('サーバーに接続できませんでした（オフラインの可能性があります）', 0)
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // API 以外（HTML）が返るのは、まだ Worker がデプロイされていないとき
    throw new ApiError(`サーバーの応答を解釈できませんでした（HTTP ${res.status}）`, res.status)
  }
  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`
    throw new ApiError(message, res.status)
  }
  return body as T
}

export function fetchMe(): Promise<Me> {
  return request<Me>('api/me')
}

export function fetchUsers(): Promise<UsersResponse> {
  return request<UsersResponse>('api/admin/users')
}

export function addUser(email: string, displayName: string, note: string): Promise<MutationResult> {
  return request('api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, displayName, note }),
  })
}

export function updateUser(email: string, displayName: string, note: string): Promise<MutationResult> {
  return request('api/admin/users', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, displayName, note }),
  })
}

/**
 * その人が使えるコースを設定する。**空配列＝制限なし（全コース）**。
 * 表示名・メモのキーは送らない＝サーバー側で既存値が保持される。
 */
export function setAllowedCourses(email: string, courseIds: string[]): Promise<MutationResult> {
  return request('api/admin/users', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, allowedCourses: courseIds }),
  })
}

/**
 * purge=true で進捗も含めて完全削除（既定は進捗を残してアクセスのみ取り消し）。
 * メールはクエリでなく本文で送る＝ Cloudflare のリクエストログに利用者のメールを残さないため。
 */
export function removeUser(
  email: string,
  purge = false,
): Promise<MutationResult & { sessionRevoked: boolean }> {
  return request('api/admin/users/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, purge }),
  })
}

export function fetchAdminLog(): Promise<{ entries: AdminLogEntry[] }> {
  return request('api/admin/log')
}

export function fetchWordRequests(): Promise<WordRequestsResponse> {
  return request('api/admin/word-requests')
}

/** promoted=true で次回のコース本体ビルドに回す候補として印を付ける。false で解除 */
export function promoteWordCard(cardId: string, promoted: boolean): Promise<MutationResult> {
  return request('api/admin/word-requests/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, promoted }),
  })
}

/** 生成カードを削除する（次に誰かが同じ語を引くと再生成される） */
export function deleteWordCard(cardId: string): Promise<MutationResult> {
  return request('api/admin/word-requests/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId }),
  })
}

export interface ReportExample {
  text: string
  translation: string
}

export type ReportStatus = 'open' | 'planned' | 'fixed' | 'rejected'

/** カードの誤り報告1件（docs/word-request-design.md。管理画面「カードの誤り報告」タブ） */
export interface CardReport {
  id: number
  at: string
  email: string
  courseId: string
  cardId: string
  idEpoch: number
  headword: string
  reading: string
  gloss: string
  pos: string
  examples: ReportExample[]
  reason: string
  note: string
  status: ReportStatus
  adminNote: string
  updatedAt: string
}

export interface ReportsResponse {
  reports: CardReport[]
}

export function fetchReports(): Promise<ReportsResponse> {
  return request('api/admin/reports')
}

export function updateReportStatus(id: number, status: ReportStatus, adminNote: string): Promise<MutationResult> {
  return request('api/admin/reports/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status, adminNote }),
  })
}

export interface CorrectionPayload {
  courseId: string
  cardId: string
  headword: string
  reading: string
  gloss: string
  pos: string
  examples: ReportExample[]
}

/** 是正を確定（新規作成／更新とも同じエンドポイント。card_id が主キーなので upsert） */
export function setCorrection(payload: CorrectionPayload): Promise<MutationResult> {
  return request('api/admin/corrections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** 是正を取り消す（次回コース読み込みからは元のカードに戻る） */
export function deleteCorrection(cardId: string): Promise<MutationResult> {
  return request('api/admin/corrections/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId }),
  })
}

/**
 * 指定ユーザーの端末移行スナップショット（gzip バイト列）を取得する。
 * JSON を返す request() は使えない（本文がバイナリのため）ので、fetch を直接叩く。
 */
export async function downloadUserSnapshot(email: string): Promise<Blob> {
  let res: Response
  try {
    res = await fetch(apiUrl('api/admin/snapshot'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  } catch {
    throw new ApiError('サーバーに接続できませんでした（オフラインの可能性があります）', 0)
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string } | null
      if (body?.error) message = body.error
    } catch {
      /* 失敗時は JSON、成功時はバイナリ。ここに来るのは失敗時だけなので JSON のはず */
    }
    throw new ApiError(message, res.status)
  }
  return await res.blob()
}
