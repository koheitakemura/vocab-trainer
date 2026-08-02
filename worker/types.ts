/**
 * 管理者画面バックエンド（Cloudflare Worker）の型定義。
 *
 * このアプリは元々 100% クライアントサイド（進捗は端末内 IndexedDB のみ・アカウント無し）。
 * 管理者が ①利用者のログイン許可を追加/削除でき ②各自の進捗を一覧できる ようにするために、
 * 最小限のサーバ面だけを足している。学習ロジックは一切サーバへ移していない：
 *
 *   - 誰がログインできるか … Cloudflare Access の許可メールリスト（＝唯一の真実。
 *     ここを編集することが「登録/削除」の実体。Worker は Cloudflare API 経由で編集する）
 *   - 進捗                 … D1。語ごとの学習データは送らず、コース別の集計値だけを送る
 *   - 本人確認             … Access が済ませたものを流用（Cf-Access-Jwt-Assertion を検証）。
 *     パスワード・セッション・ユーザーテーブルの認証は自前実装しない
 */

/** Worker のバインディング・設定値（wrangler.jsonc の vars と Secrets） */
export interface Env {
  /** ビルド済み SPA（dist）。API 以外のパスはこれにそのまま委譲する */
  ASSETS: Fetcher
  /** 名簿と進捗サマリの保存先 */
  DB: D1Database
  /**
   * 端末移行用の進捗スナップショット（gzip 済み JSON バイト列）の保存先。
   * D1 ではなく R2 にしたのは、D1 の1行 2MB 上限に実データが収まらないため
   * （実測: 全コース学習で1語≈400B・約4,900語で2MB到達。snapshot.ts の冒頭を参照）。
   */
  SNAPSHOTS: R2Bucket
  /**
   * 検索して見つからない語の生成（docs/word-request-design.md §9・worker/wordgen.ts）。
   * Workers AI はローカル開発でも実アカウントに到達する（ローカルシミュレーションが無い）ため、
   * `wrangler dev` で試すだけでも実際の無料枠を消費する。
   */
  AI: Ai

  // ── Cloudflare Access（本人確認）
  /** 例: https://divine-bread-a024.cloudflareaccess.com（末尾スラッシュ無し） */
  TEAM_DOMAIN: string
  /** Access アプリケーションの AUD タグ。JWT の audience 検証に使う（必須） */
  POLICY_AUD: string
  /** 管理者のメール（カンマ区切り）。空なら管理者不在＝管理APIは全拒否（fail closed） */
  ADMIN_EMAILS: string

  // ── Cloudflare API（ログイン許可リストの編集）
  CF_ACCOUNT_ID: string
  /**
   * Zero Trust → 再利用可能なコンポーネント → リスト（Emails 型）の UUID。
   * **任意**——未設定なら実行時に名前かメール型が1つだけかで自動解決する（cf.ts の resolveListId）。
   * UUID をダッシュボードで探す手間をなくすため。複数のメール型リストを使い分けるときだけ指定する。
   */
  CF_ACCESS_EMAIL_LIST_ID?: string
  /** ↑を指定しないとき、対象リストを名前で選ぶ（例: "Vocab Trainer User"）。これも任意 */
  CF_ACCESS_EMAIL_LIST_NAME?: string
  /** Secret。Zero Trust リスト編集権限のトークン（未設定なら登録/削除は 503 を返す） */
  CF_API_TOKEN?: string
  /**
   * 'simulate' のときだけ Access リストを D1 の名簿で代用する（ローカル検証用）。
   * .dev.vars にしか置かない＝デプロイ物には含まれない。未設定＝本番の実 API 経路。
   */
  CF_MODE?: string

  // ── ローカル開発用（.dev.vars のみ。wrangler deploy には含まれない）
  /** 'true' のときだけ JWT 検証を飛ばして DEV_EMAIL を本人として扱う */
  ALLOW_DEV_AUTH?: string
  DEV_EMAIL?: string
}

/** 認証済みの利用者 */
export interface Identity {
  /** 小文字に正規化したメール（D1 の主キー） */
  email: string
  isAdmin: boolean
}

/** クライアントが送ってくるコース別の進捗サマリ（語ごとのデータは含まない） */
export interface CourseProgressInput {
  courseId: string
  /** 一度でも採点した語数（words started） */
  started: number
  /** 覚えた語数（I know + Mastered） */
  known: number
  /** 卒業（Mastered）語数 */
  mastered: number
  /** 累計レビュー回数 */
  reviews: number
  /** レビュー実績のあった延べ日数 */
  daysStudied: number
  /** 現在の連続学習日数 */
  streak: number
  /** 最長連続学習日数 */
  longestStreak: number
  /** 最終学習日 YYYY-MM-DD（未学習なら null） */
  lastStudiedDate: string | null
}

/** POST /api/sync のリクエスト本体 */
export interface SyncInput {
  courses: CourseProgressInput[]
}

/** 管理画面が表示する利用者1件 */
export interface AdminUser {
  email: string
  displayName: string
  note: string
  status: 'active' | 'removed'
  createdAt: string
  lastSeenAt: string | null
  /** Cloudflare Access の許可リストに実際に載っているか（null＝リストを取得できなかった） */
  inAccessList: boolean | null
  /** その人が使えるコース ID。**null＝制限なし（全コース）** */
  allowedCourses: string[] | null
  courses: CourseProgressInput[]
}
