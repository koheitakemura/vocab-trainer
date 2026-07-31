import type { Env } from './types'
import { isDevBypass } from './auth'
import { listUsersWithProgress } from './store'

/**
 * Cloudflare API 経由での「ログイン許可リスト」操作。
 *
 * このアプリのログイン可否は Cloudflare Access が決めており、許可メールは
 * Zero Trust の Emails 型リスト（再利用可能なコンポーネント → リスト）1 か所で管理している。
 * 管理画面の「登録／削除」は、そのリストの append / remove そのもの
 * ＝ D1 の名簿だけ書き換えても意味がない（ログインできる/できないが変わらない）ため、
 *   ①リストを更新 → ②成功したら D1 名簿を更新、の順で行う。
 */

/** Cloudflare API 呼び出しの失敗（メッセージは管理者にそのまま見せて診断可能にする） */
export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message)
    this.name = 'CloudflareError'
  }
}

/**
 * 実 API を叩かず D1 の名簿を許可リストとみなすローカル検証モード。
 * **本番（POLICY_AUD あり）では絶対に有効にならない**——ここを env の値だけで判定すると、
 * 設定ミス時に「削除できたと表示されるのに実際は許可リストが変わらない」silent fail-open になる。
 */
function simulating(env: Env): boolean {
  return env.CF_MODE === 'simulate' && isDevBypass(env)
}

/** Access リスト連携が使える設定になっているか */
export function accessListConfigured(env: Env): boolean {
  if (simulating(env)) return true
  return Boolean(env.CF_API_TOKEN?.trim() && env.CF_ACCOUNT_ID?.trim() && env.CF_ACCESS_EMAIL_LIST_ID?.trim())
}

interface CfEnvelope<T> {
  success: boolean
  errors?: Array<{ code?: number; message?: string }>
  result?: T
}

async function cfFetch<T>(env: Env, path: string, init?: RequestInit): Promise<T | undefined> {
  if (!accessListConfigured(env)) {
    throw new CloudflareError(
      'Cloudflare 連携が未設定です（CF_API_TOKEN / CF_ACCOUNT_ID / CF_ACCESS_EMAIL_LIST_ID）',
      503,
    )
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  })
  let body: CfEnvelope<T>
  try {
    body = (await res.json()) as CfEnvelope<T>
  } catch {
    throw new CloudflareError(`Cloudflare API の応答を解釈できませんでした（HTTP ${res.status}）`)
  }
  if (!res.ok || !body.success) {
    // トークン自体は載らない。API 側のエラー文はそのまま出したほうが原因が分かる
    const detail = (body.errors ?? []).map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join(' / ')
    throw new CloudflareError(`Cloudflare API エラー（HTTP ${res.status}）: ${detail || '詳細不明'}`)
  }
  return body.result
}

/**
 * ローカル検証（wrangler dev）用の代用実装。CF_MODE='simulate' のときだけ通る。
 * 実 API を叩かず「D1 の active な名簿＝許可リスト」とみなす。
 * .dev.vars にしか CF_MODE を置かないので、デプロイ物からは到達しない。
 */
async function simulatedList(env: Env): Promise<string[]> {
  const rows = await listUsersWithProgress(env)
  return rows.filter((r) => r.user.status === 'active').map((r) => r.user.email)
}

/** 現在ログインを許可されているメール一覧 */
export async function listAccessEmails(env: Env): Promise<string[]> {
  if (simulating(env)) return simulatedList(env)
  const result = await cfFetch<Array<{ value?: string }>>(
    env,
    `/accounts/${env.CF_ACCOUNT_ID}/gateway/lists/${env.CF_ACCESS_EMAIL_LIST_ID}/items?per_page=1000`,
  )
  return (result ?? [])
    .map((item) => (typeof item?.value === 'string' ? item.value.trim().toLowerCase() : ''))
    .filter(Boolean)
}

/**
 * 許可リストへ追加。
 * 既に載っているメールを append すると Cloudflare 側がエラーを返し得るため、先に在籍を確認する
 *（「ダッシュボードで直接追加された人を名簿に載せる」導線が、重複エラーで失敗しないように）。
 */
export async function addAccessEmail(env: Env, email: string, description: string): Promise<void> {
  if (simulating(env)) return
  const current = await listAccessEmails(env)
  if (current.includes(email)) return
  await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/gateway/lists/${env.CF_ACCESS_EMAIL_LIST_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({ append: [{ value: email, description: description.slice(0, 200) }] }),
  })
}

/** 許可リストから削除（＝次回以降ログインできなくなる） */
export async function removeAccessEmail(env: Env, email: string): Promise<void> {
  if (simulating(env)) return
  await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/gateway/lists/${env.CF_ACCESS_EMAIL_LIST_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({ remove: [email] }),
  })
}

/**
 * 既にログイン中のセッションを失効させる（ベストエフォート）。
 * リストから消しても、発行済みセッションはセッション有効期間が切れるまで生きているため、
 * 「今すぐ締め出す」にはこれが要る。権限不足等で失敗しても削除自体は成立しているので、
 * 例外にせず false を返して管理画面に「既存セッションは残る」旨を出す。
 */
export async function revokeUserSessions(env: Env, email: string): Promise<boolean> {
  if (simulating(env)) return true
  try {
    await cfFetch(env, `/accounts/${env.CF_ACCOUNT_ID}/access/organizations/revoke_user`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
    return true
  } catch {
    return false
  }
}
