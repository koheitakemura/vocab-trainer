import { db } from './db'
import { apiUrl } from './sync'
import type { CourseId, Example, PendingReport, ReportReason } from '../types'

/**
 * カードの誤り報告（オフライン耐性つき）。
 *
 * 送信を直接試み、失敗（オフライン・未デプロイ・一時的なサーバーエラー）なら
 * IndexedDB の pendingReports へ退避して後で再送する——sync.ts の進捗同期と同じ
 * 「握りつぶさず・でも画面は壊さない」方針。ただし進捗同期と違い、これは
 * **利用者が能動的に送った1件のフィードバック**なので、黙って消えたら信頼を失う。
 * 「送信しました」と「今は送れないので後で送ります」を UI 側で必ず出し分ける。
 */

export interface ReportDraft {
  courseId: CourseId
  cardId: string
  idEpoch: number
  headword: string
  reading: string
  gloss: string
  pos: string
  examples: Example[]
  reason: ReportReason
  note: string
}

export type SubmitReportResult = 'sent' | 'queued' | 'rejected'

/** レート制限超過・不正な入力などサーバーが明示的に拒否した場合のメッセージ */
export class ReportRejected extends Error {}

/**
 * 1件送信を試みる。オフライン・サーバー未応答は 'queued'（後で自動再送）、
 * 4xx（レート制限・検証エラー）は ReportRejected を投げて呼び出し側にそのまま見せる
 * ——これは再送しても直らない失敗なので、キューに入れて溜め続けるのは不親切なため。
 */
export async function submitReport(draft: ReportDraft): Promise<SubmitReportResult> {
  let res: Response
  try {
    res = await fetch(apiUrl('api/reports'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
      credentials: 'same-origin',
    })
  } catch {
    await queueReport(draft)
    return 'queued'
  }
  if (res.ok) return 'sent'
  if (res.status >= 400 && res.status < 500) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ReportRejected(body?.error ?? `送信できませんでした（HTTP ${res.status}）`)
  }
  // 5xx はサーバー側の一時的な問題。再送で直る可能性があるのでキューへ
  await queueReport(draft)
  return 'queued'
}

async function queueReport(draft: ReportDraft): Promise<void> {
  const row: PendingReport = { ...draft, createdAt: new Date().toISOString() }
  await db.pendingReports.add(row)
}

/**
 * キューにある報告をまとめて再送する。1件でもレート制限等の 4xx で拒否されたら、
 * それ以降の再送は今回のフラッシュでは止める（同じ理由で残り全件も弾かれる可能性が高く、
 * 無駄なリクエストを連打しないため）。次回のフラッシュ機会に改めて試す。
 */
export async function flushPendingReports(): Promise<void> {
  const rows = await db.pendingReports.orderBy('id').toArray()
  for (const row of rows) {
    const { id, createdAt: _createdAt, ...draft } = row
    let res: Response
    try {
      res = await fetch(apiUrl('api/reports'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
        credentials: 'same-origin',
      })
    } catch {
      return // オフラインのまま。次の機会に
    }
    if (res.ok) {
      if (id !== undefined) await db.pendingReports.delete(id)
      continue
    }
    if (res.status >= 400 && res.status < 500) return // レート制限等。今回はここで打ち切る
    // 5xx はそのまま残し、次回のフラッシュへ持ち越す
  }
}

const MIN_INTERVAL_MS = 60_000
let lastFlushAt = 0

function flushIfStale(): void {
  if (Date.now() - lastFlushAt < MIN_INTERVAL_MS) return
  lastFlushAt = Date.now()
  void flushPendingReports()
}

/** 起動時・オンライン復帰時・離脱時にキューの再送を試みる（アプリ起動時に1回だけ呼ぶ） */
export function startReportFlush(): void {
  window.setTimeout(() => flushIfStale(), 4000)
  window.addEventListener('online', flushIfStale)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushIfStale()
  })
}
