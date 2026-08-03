import type { CourseId } from '../types'
import { apiUrl } from './sync'

/**
 * 未割当コースのプレビュー画面から送る「利用したい」リクエスト。
 *
 * report.ts と違い、オフラインキューは持たない——この画面に来ている時点で直前に
 * コースデータの fetch に成功しているので、実質オフラインではあり得ない。
 * カードの誤り報告ほど「送れなかったら困る」重みも無いので、失敗時はエラーを見せて
 * 利用者にボタンを押し直してもらえば十分（worker/courseRequests.ts の設計コメント参照）。
 */

/** サーバーが明示的に拒否した場合のメッセージ（レート制限・検証エラー等） */
export class CourseRequestRejected extends Error {}

export type RequestCourseAccessResult = 'sent' | 'already-requested' | 'already-granted'

export async function requestCourseAccess(courseId: CourseId): Promise<RequestCourseAccessResult> {
  let res: Response
  try {
    res = await fetch(apiUrl('api/course-requests'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId }),
      credentials: 'same-origin',
    })
  } catch {
    throw new CourseRequestRejected('サーバーに接続できませんでした（オフラインの可能性があります）')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new CourseRequestRejected(body?.error ?? `送信できませんでした（HTTP ${res.status}）`)
  }
  const data = (await res.json()) as { alreadyGranted?: boolean; alreadyRequested?: boolean }
  if (data.alreadyGranted) return 'already-granted'
  if (data.alreadyRequested) return 'already-requested'
  return 'sent'
}
