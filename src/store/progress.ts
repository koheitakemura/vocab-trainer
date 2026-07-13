import { db } from './db'
import { gradeCard, newCard, State, type ReviewGrade } from '../srs/scheduler'
import type { VocabCard, WordProgress } from '../types'

/** カードの進捗行が無ければ new で作成して返す */
export async function getOrCreateProgress(card: VocabCard): Promise<WordProgress> {
  const existing = await db.progress.get(card.id)
  if (existing) return existing
  const fresh: WordProgress = {
    cardId: card.id,
    courseId: card.courseId,
    status: 'new',
    fsrs: newCard(),
    reviewedCount: 0,
  }
  await db.progress.put(fresh)
  return fresh
}

/**
 * レビュー結果を記録し、FSRS 状態と WordStatus を更新。
 * 戻り値の wasNew はこの採点が初採点だったか、prevGrade は上書き前の直近の採点（演出の判定用）。
 */
export async function recordReview(
  cardId: string,
  grade: ReviewGrade,
): Promise<{ wasNew: boolean; prevGrade?: ReviewGrade }> {
  const p = await db.progress.get(cardId)
  if (!p) return { wasNew: false }
  const wasNew = p.status === 'new'
  const prevGrade = p.lastGrade
  const nextFsrs = gradeCard(p.fsrs, grade)
  const status: WordProgress['status'] =
    grade === 'again'
      ? 'learning'
      : nextFsrs.state === State.Review
        ? 'known'
        : 'learning'
  await db.progress.put({
    ...p,
    fsrs: nextFsrs,
    status,
    lastGrade: grade,
    reviewedCount: p.reviewedCount + 1,
    lastReviewedAt: new Date().toISOString(),
  })
  return { wasNew, prevGrade }
}

/** 進捗を JSON 文字列に書き出す（手動バックアップ／端末移行用） */
export async function exportProgress(): Promise<string> {
  const progress = await db.progress.toArray()
  return JSON.stringify(
    { format: 'vocab-trainer/progress', version: 1, exportedAt: new Date().toISOString(), progress },
    null,
    2,
  )
}

/** JSON をインポートして進捗を復元。取り込んだ件数を返す。 */
export async function importProgress(json: string): Promise<number> {
  const parsed = JSON.parse(json) as { progress?: WordProgress[] }
  const items = (parsed.progress ?? []).map((p) => ({ ...p, fsrs: reviveFsrsDates(p.fsrs) }))
  await db.progress.bulkPut(items)
  return items.length
}

/** JSON 化で文字列になった Date を Date に戻す（ts-fsrs は Date 前提） */
function reviveFsrsDates(fsrs: WordProgress['fsrs']): WordProgress['fsrs'] {
  return {
    ...fsrs,
    due: new Date(fsrs.due),
    last_review: fsrs.last_review ? new Date(fsrs.last_review) : undefined,
  }
}

/** デモ/開発用：このコースの進捗を全消去して初期状態に戻す */
export async function resetCourseProgress(courseId: string): Promise<void> {
  await db.progress.where('courseId').equals(courseId).delete()
}
