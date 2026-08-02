import { db } from './db'
import { exportProgress, importProgress } from './progress'
import { apiUrl } from './sync'

/**
 * 端末移行用の進捗スナップショット同期（学習した単語ごとの状態を丸ごとサーバーへ）。
 *
 * sync.ts（コース別の集計値を管理者向けに送る片方向ミラー）とは**目的も頻度も別物**なので、
 * ファイル・db.meta のキーとも意図的に分離したまま実装する。片方が新しく片方が古い状態は
 * 正常に起こりうる——混ぜて1つのタイマー・1組のキーにすると、その区別が付かなくなる。
 */

const LAST_UPLOAD_KEY = 'lastSnapshotUploadAt'
/** 直近アップロード成功時点での累計レビュー回数（次回の発火判定の基準値） */
const REVIEW_BASELINE_KEY = 'snapshotReviewBaseline'
/** 空上書きガード（409）に引っかかって止まっている場合の時刻。ある間は自動リトライしない */
const GUARD_BLOCKED_KEY = 'snapshotGuardBlockedAt'

const MIN_INTERVAL_MS = 30 * 60_000 // 30分
const STALE_MS = 6 * 60 * 60_000 // 6時間
const REVIEW_THRESHOLD = 20

/** 連打抑止用。成功・失敗を問わず「試みた」時点で進める */
let lastAttemptAt = 0

function supportsCompression(): boolean {
  // 古いブラウザは gzip 化できない。例外を投げず、その端末は既存の手動 Backup/Restore が
  // 唯一のバックアップ手段になる（Worker 側を非圧縮フォーマットにも対応させることはしない）。
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

async function gzipText(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return await new Response(stream).arrayBuffer()
}

async function gunzipToText(buf: ArrayBuffer): Promise<string> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

/** 累計レビュー回数。dailyStats.reviews は日次の追記型カウンタなので合計が単調増加する
 *（growth.ts の buildGrowth と同じ導出）。recordReview のホットパスには一切触れない。 */
async function totalReviewCount(): Promise<number> {
  const stats = await db.dailyStats.toArray()
  return stats.reduce((sum, s) => sum + s.reviews, 0)
}

async function getMeta(key: string): Promise<unknown> {
  return (await db.meta.get(key))?.value
}

async function shouldUpload(): Promise<boolean> {
  if (!supportsCompression()) return false
  const now = Date.now()
  if (now - lastAttemptAt < MIN_INTERVAL_MS) return false
  // 空上書きガードで止まっている間は、本人が確認するまで自動では再送しない
  if (await getMeta(GUARD_BLOCKED_KEY)) return false

  const lastUpload = await getMeta(LAST_UPLOAD_KEY)
  const lastUploadMs = typeof lastUpload === 'string' ? Date.parse(lastUpload) : 0
  const stale = now - lastUploadMs > STALE_MS

  const baseline = await getMeta(REVIEW_BASELINE_KEY)
  const baselineCount = typeof baseline === 'number' ? baseline : 0
  const current = await totalReviewCount()
  const enoughReviews = current - baselineCount >= REVIEW_THRESHOLD

  return stale || enoughReviews
}

export type UploadResult = 'ok' | 'blocked' | 'skipped' | 'error'

/**
 * 1回アップロードを試みる。
 * confirmOverwrite=true は、本人が「空上書きガード」の警告を見て「続行」を選んだときだけ渡す
 * （自動リトライでは絶対に true にしない——サイレントに空データで上書きする経路を作らないため）。
 */
export async function uploadSnapshot(confirmOverwrite = false): Promise<UploadResult> {
  lastAttemptAt = Date.now()
  if (!supportsCompression()) return 'skipped'
  try {
    const json = await exportProgress()
    const body = await gzipText(json)
    const res = await fetch(apiUrl('api/snapshot'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/gzip',
        ...(confirmOverwrite ? { 'X-Confirm-Overwrite': 'true' } : {}),
      },
      body,
      credentials: 'same-origin',
    })
    if (res.status === 409) {
      await db.meta.put({ key: GUARD_BLOCKED_KEY, value: new Date().toISOString() })
      return 'blocked'
    }
    if (!res.ok) return 'error'
    const current = await totalReviewCount()
    await db.meta.bulkPut([
      { key: LAST_UPLOAD_KEY, value: new Date().toISOString() },
      { key: REVIEW_BASELINE_KEY, value: current },
    ])
    await db.meta.delete(GUARD_BLOCKED_KEY)
    return 'ok'
  } catch {
    // オフライン等。lastAttemptAt は進めてあるので MIN_INTERVAL_MS 後にまた試す
    return 'error'
  }
}

async function uploadIfDue(): Promise<void> {
  if (await shouldUpload()) void uploadSnapshot()
}

/**
 * 送信タイミングを仕掛ける（アプリ起動時に1回だけ呼ぶ）。sync.ts の startProgressSync とは
 * 完全に独立したタイマー・イベント登録（片方の失敗がもう片方に波及しない）。
 *
 * **pagehide / keepalive は使わない**——keepalive 付き fetch の本文上限は 64KiB で、
 * MB 級になりうるスナップショットでは静かに送信が打ち切られる。visibilitychange(hidden) と
 * 可視中の定期タイマーだけに頼り、「閉じる瞬間に必ず送る」ことは最初から狙わない。
 */
export function startSnapshotSync(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void uploadIfDue()
  })
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void uploadIfDue()
  }, MIN_INTERVAL_MS)
}

/** サーバー側の最新スナップショットの有無・サイズ・更新時刻だけを取る（本体は落とさない） */
export interface SnapshotMeta {
  exists: boolean
  uploadedAt?: string
  bytes?: number
}

export async function fetchSnapshotMeta(): Promise<SnapshotMeta | null> {
  try {
    const res = await fetch(apiUrl('api/snapshot/meta'), { credentials: 'same-origin' })
    if (!res.ok) return null
    return (await res.json()) as SnapshotMeta
  } catch {
    return null
  }
}

/** サーバーから復元する。取り込んだ progress 行数を返す（Phase 6 の復元 UI が使う） */
export async function downloadAndRestoreSnapshot(): Promise<number> {
  const res = await fetch(apiUrl('api/snapshot'), { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`スナップショットの取得に失敗しました（${res.status}）`)
  const buf = await res.arrayBuffer()
  const json = await gunzipToText(buf)
  return await importProgress(json)
}
