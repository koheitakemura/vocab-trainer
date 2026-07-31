import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Env, Identity } from './types'

/**
 * 本人確認は Cloudflare Access が済ませたものを流用する。
 *
 * Access は認証を通したリクエストに署名付き JWT を Cf-Access-Jwt-Assertion ヘッダで付ける。
 * **ヘッダのメールアドレス（Cf-Access-Authenticated-User-Email）をそのまま信用してはいけない**
 * ——Access を経由しない経路が万一存在すれば任意に詐称できるため。必ず JWT の署名・issuer・
 * audience(AUD) を検証し、payload から取り出したメールだけを本人として扱う。
 *
 * 署名検証は jose（標準的な JOSE 実装）に任せる。JWT 検証の自前実装は alg 混同・kid 取り違え等の
 * 典型的な脆弱性を作り込みやすく、ここは自作しないほうが安全。
 */

/** 認証・認可の失敗（HTTP ステータスを持つ） */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

// JWKS（Access の公開鍵）は isolate 内で使い回す。jose 側が取得結果をキャッシュし、
// 未知の kid が来たときだけ取り直す（鍵ローテーションに自動追従）。
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null
let jwksTeamDomain = ''

function jwksFor(teamDomain: string) {
  if (!jwksCache || jwksTeamDomain !== teamDomain) {
    jwksCache = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))
    jwksTeamDomain = teamDomain
  }
  return jwksCache
}

/** 末尾スラッシュを落とし https:// を補う（TEAM_DOMAIN の書き方揺れを吸収） */
function normalizeTeamDomain(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) throw new AuthError('TEAM_DOMAIN が未設定です', 500)
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** ADMIN_EMAILS（カンマ区切り）を集合に。空なら管理者不在＝管理APIは全拒否になる */
export function adminEmails(env: Env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** Cookie ヘッダから CF_Authorization を拾う（ヘッダが無い経路のフォールバック） */
function tokenFromCookie(request: Request): string | null {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === 'CF_Authorization') return rest.join('=') || null
  }
  return null
}

/**
 * リクエストの本人を確定する。検証に通らなければ AuthError を投げる。
 * ローカル検証（wrangler dev）だけは ALLOW_DEV_AUTH='true' で DEV_EMAIL を本人として扱う。
 * ALLOW_DEV_AUTH は .dev.vars にしか置かない＝ wrangler deploy の成果物には入らない。
 */
export async function authenticate(request: Request, env: Env): Promise<Identity> {
  // 開発バイパスは **POLICY_AUD が未設定のときだけ** 有効。本番には必ず AUD が入っているので、
  // ダッシュボードで ALLOW_DEV_AUTH を誤って立てても JWT 検証は外れない（順序も重要：
  // 先にバイパスを見る実装だと、下の fail closed チェックがこの経路を守れない）。
  if (isDevBypass(env)) return identityOf(env.DEV_EMAIL as string, env)

  if (!env.POLICY_AUD?.trim()) {
    // AUD 未設定のまま素通ししたら誰でも管理APIを叩けてしまう。設定不備は必ず落とす。
    throw new AuthError('POLICY_AUD が未設定です（Cloudflare Access の AUD タグを設定してください）', 500)
  }

  const token = request.headers.get('cf-access-jwt-assertion') ?? tokenFromCookie(request)
  if (!token) throw new AuthError('Cloudflare Access のトークンがありません', 401)

  const teamDomain = normalizeTeamDomain(env.TEAM_DOMAIN)
  let email: string
  try {
    const { payload } = await jwtVerify(token, jwksFor(teamDomain), {
      issuer: teamDomain,
      audience: env.POLICY_AUD.trim(),
      // Access の署名は RS256。許可アルゴリズムを明示して将来の取り違えを閉じる
      algorithms: ['RS256'],
    })
    email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  } catch {
    // 失敗理由（署名不一致/期限切れ等）は攻撃者への情報になるので返さない
    throw new AuthError('認証トークンが無効です', 401)
  }
  if (!email) throw new AuthError('トークンにメールアドレスが含まれていません', 401)
  return identityOf(email, env)
}

function identityOf(rawEmail: string, env: Env): Identity {
  const email = rawEmail.trim().toLowerCase()
  return { email, isAdmin: adminEmails(env).has(email) }
}

/**
 * ローカル開発の認証バイパスが有効か。
 * 本番（POLICY_AUD あり）では常に false になる＝設定ミスで本番が素通しにならない。
 * cf.ts の CF_MODE='simulate' も同じ条件に揃えている。
 */
export function isDevBypass(env: Env): boolean {
  return env.ALLOW_DEV_AUTH === 'true' && Boolean(env.DEV_EMAIL) && !env.POLICY_AUD?.trim()
}

/** 管理者でなければ 403。管理APIの入口で必ず通す */
export function requireAdmin(identity: Identity): void {
  if (!identity.isAdmin) throw new AuthError('管理者権限がありません', 403)
}

/**
 * CSRF 対策：状態を変える要求は同一オリジンからのものだけ受ける。
 *
 * 本人確認は Access の Cookie（CF_Authorization）に依存しており、Cookie はブラウザが自動で付ける。
 * つまり管理者がログイン中に攻撃者のページを開くと、そこからのクロスサイト POST にも Cookie が付き、
 * Access がエッジで正規の JWT を注入してしまう＝ JWT 検証だけでは CSRF を防げない。
 * （enctype="text/plain" のフォーム POST は preflight が起きないため CORS も効かない。）
 */
export function assertSameOrigin(request: Request, url: URL): void {
  if (request.method === 'GET' || request.method === 'HEAD') return
  const site = request.headers.get('sec-fetch-site')
  if (site) {
    if (site !== 'same-origin') throw new AuthError('クロスサイトからの要求は受け付けません', 403)
    return
  }
  // Sec-Fetch-Site を送らない古いブラウザ向けのフォールバック。
  // fetch は GET/HEAD 以外に必ず Origin を付けるので、一致しなければ拒否でよい。
  if (request.headers.get('origin') !== url.origin) {
    throw new AuthError('クロスサイトからの要求は受け付けません', 403)
  }
}
