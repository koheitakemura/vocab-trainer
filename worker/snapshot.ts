import type { Env } from './types'

/**
 * 端末移行用の進捗スナップショット（R2）。
 *
 * D1 ではなく R2 に置く理由：D1 は1行（文字列/BLOB）に 2,000,000 バイトのハード上限があり、
 * 実データ（1語あたり実測 約400B の progress 行）では**通算 約4,900語**（全カタログの1割）で
 * 到達してしまう。日常利用なら1年未満で破綻する水準で、プラン変更でも解けない
 * （Cloudflare 公式 D1 Limits: Maximum string/BLOB/table row size = 2 MB）。
 * R2 なら中身を解析せず gzip バイト列のまま put/get するだけなので、この上限に一切当たらない。
 *
 * **Worker はこのスナップショットの中身を一切解析しない**（JSON.parse も gunzip もしない）。
 * Workers Free プランの CPU 時間は 1 リクエストあたり 10ms しかなく、数千語ぶんの
 * JSON.parse だけで軽く超過する（実測: 10,000行で 15.3ms）。サイズ比較や R2 の
 * list/delete は I/O 待ちで CPU をほぼ消費しないので、ここを守る限り Free でも動く。
 */

const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024 // 5MB。実データ規模（gzip後 数百KB〜2.6MB想定）に余裕を持たせた独立上限。
// 既存の MAX_BODY_BYTES（worker/index.ts, 64KB・集計値専用）とは無関係——
// 混同して使い回すと、スナップショットが64KBで弾かれ「機能として動かない」事故になる。

const GZIP_MAGIC = new Uint8Array([0x1f, 0x8b])

const HISTORY_KEEP = 10

export const BINARY_HEADERS = {
  'Content-Type': 'application/gzip',
  'Cache-Control': 'no-store',
} as const

/** R2 オブジェクトキー。email は worker/auth.ts の identityOf() が EMAIL_RE で検証済みなので安全に埋め込める */
export function latestKey(email: string): string {
  return `snapshots/${email}/latest.json.gz`
}

/**
 * 世代キー。ISO 8601 風のタイムスタンプを使うのは、文字列としての辞書順が
 * そのまま時系列順になるため（R2 の list はキーの辞書順を返す＝別途ソートが要らない）。
 * この性質は ':' '.' を残したままでも成立する（R2 のキーはどちらも許容する）が、
 * URL やダッシュボード上で見たときにファイル拡張子と紛らわしくならないよう '-' に置換する。
 */
export function historyKey(email: string, at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-')
  return `snapshots/${email}/history/${stamp}.json.gz`
}

export function historyPrefix(email: string): string {
  return `snapshots/${email}/history/`
}

export function allPrefix(email: string): string {
  return `snapshots/${email}/`
}

/**
 * 入力の実バイト数を確認し、gzip として妥当かを検査する（中身は解析しない）。
 *
 * `request.arrayBuffer()` は5MBの上限判定より前に本文を全量メモリへ読み切ってしまう
 * （Workers のリクエスト本文上限100MBまで到達しうる）ため、本来はサイズ判定を早期化したい。
 * しかし実機検証で、本文を**最後まで読み切る前に**レスポンスを返す／例外を投げる実装
 * （ReadableStream の手動読み取り＋早期 throw、reader.cancel()、Content-Length による
 * 本文読み取り前の早期 throw のいずれも）は、ローカル実行環境（wrangler dev の Miniflare）
 * で個別リクエストの不透明な 500、あるいは**サーバープロセスごとクラッシュする**ことを
 * 複数パターンで確認した。この API は認証済み・Access配下のユーザーしか到達できない
 * 内部APIであり、原因不明のクラッシュを本番に持ち込むリスクの方が、5MB超という限定的な
 * 入力での一時的な過大メモリ使用より重い。確実に安定動作する「常に全量読み切ってから
 * 判定する」実装を採用する（早期化は将来 Cloudflare 側の挙動を再確認できたときの課題）。
 */
export async function readBinary(request: Request): Promise<ArrayBuffer> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!type.includes('application/gzip')) {
    throw new SnapshotError('Content-Type は application/gzip にしてください', 400)
  }
  const body = new Uint8Array(await request.arrayBuffer())
  // content-length ヘッダは送らない/偽ることができるので使わない。実バイト数で判定する。
  if (body.byteLength === 0) throw new SnapshotError('本文が空です', 400)
  if (body.byteLength > MAX_SNAPSHOT_BYTES) {
    throw new SnapshotError(`本文が大きすぎます（上限 ${MAX_SNAPSHOT_BYTES} バイト）`, 400)
  }
  if (body[0] !== GZIP_MAGIC[0] || body[1] !== GZIP_MAGIC[1]) {
    throw new SnapshotError('gzip 形式ではありません', 400)
  }
  return body.buffer
}

/** スナップショット関連の失敗（HTTP ステータスを持つ） */
export class SnapshotError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'SnapshotError'
  }
}

/**
 * 空アップロードで既存の控えを潰さないためのガード。
 *
 * ブラウザが端末のストレージを自動削除した直後（例: Safari の7日ルール）に
 * アプリを開くと、空になったローカル状態がそのままアップロードされうる。
 * その1回でサーバー側の唯一の控えまで消えると、両方失われて復旧不能になる。
 *
 * 判定は中身を見ずサイズだけで行う（Worker は内容を解析しない方針を守るため）。
 * 「既存が実質空でない」かつ「新しい方が既存の10%未満」のときだけ止める。
 * 閾値は絶対値ではなく比率にしている——コース追加でスナップショットが
 * 自然に大きくなっていっても、正常な増加を誤って止めないため。
 */
export function needsOverwriteConfirmation(existingBytes: number, newBytes: number): boolean {
  const MEANINGFUL_EXISTING = 2 * 1024 // 2KB未満の既存データは「実質空」とみなし、ガードの対象にしない
  if (existingBytes < MEANINGFUL_EXISTING) return false
  return newBytes < existingBytes * 0.1
}

/**
 * 保持する世代キーを決める（新しい方から HISTORY_KEEP 件）。
 * 純粋関数として切り出してあるのは、R2 を起動せずにテストできるようにするため。
 */
export function pruneHistoryKeys(keysNewestFirst: string[], keep = HISTORY_KEEP): { keep: string[]; drop: string[] } {
  return { keep: keysNewestFirst.slice(0, keep), drop: keysNewestFirst.slice(keep) }
}

/** PUT 成功後に古い世代を削る。失敗しても PUT 自体は成功しているので例外は投げない */
export async function pruneHistory(env: Env, email: string): Promise<void> {
  try {
    const listed = await env.SNAPSHOTS.list({ prefix: historyPrefix(email) })
    // R2 の list は既定でキー昇順。ISO風タイムスタンプなので昇順＝古い→新しい。新しい順に直す。
    const keysNewestFirst = listed.objects.map((o) => o.key).sort().reverse()
    const { drop } = pruneHistoryKeys(keysNewestFirst)
    if (drop.length > 0) await env.SNAPSHOTS.delete(drop)
  } catch (err) {
    console.error('history の剪定に失敗:', err)
  }
}

/** アップロード1件を保存する（latest を更新し、退避コピーを history に残してから古い世代を剪定） */
export async function putSnapshot(env: Env, email: string, body: ArrayBuffer): Promise<void> {
  const now = new Date()
  await env.SNAPSHOTS.put(latestKey(email), body, { httpMetadata: { contentType: 'application/gzip' } })
  await env.SNAPSHOTS.put(historyKey(email, now), body, { httpMetadata: { contentType: 'application/gzip' } })
  await pruneHistory(env, email)
}

/** 指定ユーザーのスナップショットを全て削除する（完全削除フロー専用） */
export async function purgeSnapshots(env: Env, email: string): Promise<void> {
  const listed = await env.SNAPSHOTS.list({ prefix: allPrefix(email) })
  const keys = listed.objects.map((o) => o.key)
  if (keys.length > 0) await env.SNAPSHOTS.delete(keys)
}
