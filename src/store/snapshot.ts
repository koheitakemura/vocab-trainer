import { db } from './db'
import { exportProgress, importProgress, mergeProgress, PRE_RESTORE_STASH_KEY, type MergeResult } from './progress'
import { apiUrl } from './sync'
import { repository } from '../data/courseRepository'
import type { CourseId, MetaRow, WordProgress } from '../types'

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
// 復元直前の状態を1回分だけ退避しておくキー（「元に戻す」用）は progress.ts が持つ
// ——書き出しから除外する側（exportProgress）と同じ定義を見ていないと、入れ子コピーで
// スナップショットが倍々に膨らむ不具合が静かに戻ってくるため。

const MIN_INTERVAL_MS = 30 * 60_000 // 30分（連打防止の下限。これより頻繁には絶対に送らない）
const STALE_MS = 6 * 60 * 60_000 // 6時間
// 実機検証（2026-08-02）で20は厳しすぎると判明：復元直後に15語学習しても閾値未達で
// 「同期されている感じがしない」体験になった。MIN_INTERVAL_MS が既に30分の下限を
// 保証しているので、閾値はもっと低くても連打にはならない。
const REVIEW_THRESHOLD = 5

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
 *
 * 起動直後に1回だけ試す（6秒後）——これが無いと、タブを開いたまま学習し続ける限り
 * 「隠す」も「30分経過」も起きず、shouldUpload() が stale=true を返せる状態のまま
 * 永久にアップロードされない（実機で確認済みの不具合）。3秒はコース JSON の取得・
 * sync.ts 自身の初回送信と帯域を奪い合うため、それより少し後ろにずらす。
 */
export function startSnapshotSync(): void {
  window.setTimeout(() => void uploadIfDue(), 6000)
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

/**
 * importProgress() は db.meta を丸ごと clear する（progress.ts の復元＝全置換という仕様）。
 * つまり同期系のフラグ（lastSnapshotUploadAt 等）も毎回消える。放置すると：
 * - サーバー復元直後は「サーバーの方が新しい」判定が復活し、次に開いたときまた復元を promptする
 * - 手動 Restore（古いバックアップファイル）直後は、今の内容をまだサーバーへ送っていないのに
 *   「同期済み」の時刻が残ってしまう（あるいは逆に消えたままで永久に stale 判定になる）
 * どちらの復元経路でも importProgress() の直後に必ずこれを通す。
 */
async function reconcileSyncFlags(source: 'server' | 'manual', serverUploadedAt?: string): Promise<void> {
  const current = await totalReviewCount()
  const rows: MetaRow[] = [{ key: REVIEW_BASELINE_KEY, value: current }]
  if (source === 'server') {
    // サーバーの中身をそのまま書き戻しただけなので「同期済み」を名乗ってよい
    rows.push({ key: LAST_UPLOAD_KEY, value: serverUploadedAt ?? new Date().toISOString() })
  }
  await db.meta.bulkPut(rows)
  if (source === 'manual') {
    // 手動復元は「今の内容がサーバーにあるか」を知らない。正直に「未同期」へ戻し、
    // 次のタイマーで自然に再アップロードされるようにする（嘘の同期済み表示を残さない）。
    await db.meta.delete(LAST_UPLOAD_KEY)
  }
  await db.meta.delete(GUARD_BLOCKED_KEY)
}

/**
 * 手動 Restore（ファイルからの復元・CourseScreen の既存機能）の直後に呼ぶ。
 * importProgress() 自体は変更しない（既存の「全置換」の意味論をそのまま保つ）。
 */
export async function reconcileAfterManualImport(): Promise<void> {
  await reconcileSyncFlags('manual')
}

/** スナップショット中の cardId 世代スタンプ（progressEpoch:*）をコース別に取り出す */
function epochsFromMeta(meta: MetaRow[] | undefined): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of meta ?? []) {
    if (typeof m.key === 'string' && m.key.startsWith('progressEpoch:') && typeof m.value === 'number') {
      map.set(m.key.slice('progressEpoch:'.length), m.value)
    }
  }
  return map
}

/** サーバー側の方が行数が少ないコース（＝この端末にしか無い記録があるコース） */
export interface ShrinkingCourse {
  courseId: string
  /** この端末の進捗行数 */
  local: number
  /** サーバーのスナップショットに入っている進捗行数 */
  snapshot: number
}

export interface RestorePreflight {
  totalRows: number
  courseIds: string[]
  /** true なら、いずれかのコースで cardId が付け替わった後のスナップショット＝自動復元しない */
  epochMismatch: boolean
  /**
   * サーバー側の方が記録が少ないコース。多い順。
   *
   * スナップショットは端末ごとに丸ごと上書きし合う（最後に送った端末が勝つ）ので、
   * 「別の端末が古い内容を送った」「この端末の直近の学習がまだ送信されていない」状態では、
   * サーバーの方が中身は古いのにタイムスタンプだけ新しい、ということが普通に起こる。
   * 復元は統合（mergeProgress）なのでこの差分は消えないが、「押しても数字が下がらない」ことを
   * 事前に見せるための材料として数えておく（かつては全置換で、ここがそのまま消失量だった）。
   */
  shrinking: ShrinkingCourse[]
  /** shrinking の差分合計＝この端末にしか無い進捗行数 */
  deviceOnlyRows: number
}

/**
 * スナップショット内のコース別 進捗行数。
 * importProgress が捨てる status 'new' の行はここでも数えない——「取り込んだ結果」と
 * 数え方をずらすと、警告の語数が実際に消える語数と合わなくなる。
 */
export function snapshotRowCounts(rows: WordProgress[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const r of rows) {
    if (r.status === 'new') continue
    counts.set(r.courseId, (counts.get(r.courseId) ?? 0) + 1)
  }
  return counts
}

/** 端末側とスナップショット側の行数を突き合わせ、減るコースだけを減り幅の大きい順で返す */
export function shrinkingCourses(local: Map<string, number>, snapshot: Map<string, number>): ShrinkingCourse[] {
  const out: ShrinkingCourse[] = []
  for (const [courseId, localCount] of local) {
    const snapshotCount = snapshot.get(courseId) ?? 0
    if (localCount > snapshotCount) out.push({ courseId, local: localCount, snapshot: snapshotCount })
  }
  return out.sort((a, b) => b.local - b.snapshot - (a.local - a.snapshot))
}

/** この端末のコース別 progress 行数（courseId インデックスの count なので全行は読まない） */
async function localRowCounts(): Promise<Map<string, number>> {
  const courseIds = (await db.progress.orderBy('courseId').uniqueKeys()) as string[]
  const counts = new Map<string, number>()
  for (const cid of courseIds) {
    counts.set(cid, await db.progress.where('courseId').equals(cid).count())
  }
  return counts
}

/**
 * 復元前に中身を軽く覗いて判定する（Worker 側は中身を見ないので、版チェックはここでしかできない）。
 * 実際に importProgress() するかどうかは呼び出し側が決める（このシグネチャは副作用を持たない）。
 */
async function preflight(json: string): Promise<RestorePreflight> {
  const parsed = JSON.parse(json) as { progress?: WordProgress[]; meta?: MetaRow[] }
  const rows = parsed.progress ?? []
  const courseIds = [...new Set(rows.map((p) => p.courseId))]
  const snapshotEpochs = epochsFromMeta(parsed.meta)

  let epochMismatch = false
  for (const cid of courseIds) {
    const snapshotEpoch = snapshotEpochs.get(cid) ?? 1
    const course = await repository.getCourse(cid as CourseId).catch(() => null)
    const liveEpoch = course?.idEpoch ?? 1
    if (snapshotEpoch < liveEpoch) {
      epochMismatch = true
      break
    }
  }

  // 「サーバーの方が少ない」コースを数える（＝統合後もこの端末に残る記録）
  const shrinking = shrinkingCourses(await localRowCounts(), snapshotRowCounts(rows))
  const deviceOnlyRows = shrinking.reduce((n, s) => n + (s.local - s.snapshot), 0)

  return { totalRows: rows.length, courseIds, epochMismatch, shrinking, deviceOnlyRows }
}

/** このデバイスがまだ何も学習していないか（新端末判定）。progress が1行も無ければ true */
async function isLocalProgressEmpty(): Promise<boolean> {
  return (await db.progress.count()) === 0
}

async function downloadSnapshotJson(): Promise<string> {
  const res = await fetch(apiUrl('api/snapshot'), { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`スナップショットの取得に失敗しました（${res.status}）`)
  const buf = await res.arrayBuffer()
  return await gunzipToText(buf)
}

/**
 * 復元本体。退避 → 統合 → 同期フラグの書き直し → 送り返し、をまとめた手順。
 *
 * 統合（mergeProgress）であって全置換ではない——サーバーの中身が必ずしも進んでいない以上、
 * 上書きすると「まだ送信していない側の学習」がその場で消えるため（progress.ts 参照）。
 * 統合結果はこの端末にしか無いので、最後に必ず送り返す。そうしないと
 * 「A の記録を取り込んだ B」と「B の記録を知らないサーバー」がずれたままになり、
 * 次に A が開いたときに今度は A 側が古い内容を取り込むことになる。
 */
async function applyRestore(json: string, serverUploadedAt: string): Promise<MergeResult> {
  const stash = await exportProgress() // 「元に戻す」用＝統合前の状態
  const result = await mergeProgress(json)
  await reconcileSyncFlags('server', serverUploadedAt)
  await db.meta.put({ key: PRE_RESTORE_STASH_KEY, value: stash })
  // この端末にしか無い記録があるときだけ送り返す（取り込んだだけなら書き戻す意味が無い）。
  // 送信は待たない——失敗しても統合自体は成立しており、次の定期送信で追いつく。
  if (result.deviceAhead) void uploadSnapshot()
  return result
}

/** 直前の復元を取り消す（1回分だけ）。退避が無ければ null */
export async function undoLastRestore(): Promise<number | null> {
  const stash = await getMeta(PRE_RESTORE_STASH_KEY)
  if (typeof stash !== 'string') return null
  const n = await importProgress(stash)
  await reconcileSyncFlags('manual') // 巻き戻した内容がサーバーと一致する保証は無いので正直に「未同期」
  await db.meta.delete(PRE_RESTORE_STASH_KEY)
  return n
}

export type RestoreCheckResult =
  | { kind: 'none' }
  | { kind: 'merged'; added: number; updated: number }
  | { kind: 'offer'; totalRows: number; epochMismatch: boolean; shrinking: ShrinkingCourse[]; deviceOnlyRows: number }

let restoreCheckStarted = false
/** 'offer' を返したときに保持しておく本体（確認後の再ダウンロードを避けるため） */
let offeredSnapshot: { json: string; uploadedAt: string } | null = null

/**
 * アプリ起動時に1回だけ呼ぶ。ローカルが空でサーバーに記録があれば自動復元し、
 * ローカルに進捗が既にある場合は絶対に黙って上書きせず「offer」を返すだけに留める
 * （実際の復元は confirmOfferedRestore() を呼んだときだけ）。
 */
export async function checkForServerRestore(): Promise<RestoreCheckResult> {
  if (restoreCheckStarted) return { kind: 'none' }
  restoreCheckStarted = true
  if (!supportsCompression()) return { kind: 'none' }

  const meta = await fetchSnapshotMeta()
  if (!meta?.exists || !meta.uploadedAt) return { kind: 'none' }

  const localEmpty = await isLocalProgressEmpty()
  const lastUpload = await getMeta(LAST_UPLOAD_KEY)
  const lastUploadMs = typeof lastUpload === 'string' ? Date.parse(lastUpload) : 0
  const serverIsNewer = Date.parse(meta.uploadedAt) > lastUploadMs
  // ローカルが空でなく、かつサーバー側が特に新しくもないなら何もしない（毎起動チェックが軽く済む）
  if (!localEmpty && !serverIsNewer) return { kind: 'none' }

  let json: string
  try {
    json = await downloadSnapshotJson()
  } catch {
    return { kind: 'none' } // オフライン等。学習は一切妨げない
  }
  const pf = await preflight(json)

  if (localEmpty && !pf.epochMismatch) {
    const { added, updated } = await applyRestore(json, meta.uploadedAt)
    return { kind: 'merged', added, updated }
  }
  // ローカルに何かある／版が食い違う、のどちらかなら必ず本人の確認を挟む
  offeredSnapshot = { json, uploadedAt: meta.uploadedAt }
  return {
    kind: 'offer',
    totalRows: pf.totalRows,
    epochMismatch: pf.epochMismatch,
    shrinking: pf.shrinking,
    deviceOnlyRows: pf.deviceOnlyRows,
  }
}

/** checkForServerRestore() が 'offer' を返した後、本人が確認して選んだときだけ呼ぶ */
export async function confirmOfferedRestore(): Promise<MergeResult | null> {
  if (!offeredSnapshot) return null
  const { json, uploadedAt } = offeredSnapshot
  offeredSnapshot = null
  return await applyRestore(json, uploadedAt)
}
