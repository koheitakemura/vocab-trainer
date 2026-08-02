import { db } from './db'
import { REQUESTED_CATEGORY_KEY } from '../data/categories'
import type { AddedCard, CourseId, VocabCard } from '../types'

/**
 * 検索して自分で追加した語の永続化（docs/word-request-design.md）。
 * 表示は追加した本人だけ（この端末の IndexedDB に閉じる。サーバーへは送らない）。
 * cardId・進捗の isExtraCardId 判定は store/db.ts 側にある（summarize() が使うため）。
 */

/** このコースで自分が追加した語を追加日時の古い順で返す。CourseScreen が useLiveQuery で購読する。 */
export async function listAddedCards(courseId: CourseId): Promise<VocabCard[]> {
  const rows = await db.addedCards.where('courseId').equals(courseId).toArray()
  rows.sort((a, b) => a.addedAt.localeCompare(b.addedAt))
  return rows.map((r) => r.card)
}

/**
 * カードを自分の追加リストへ保存する（静的プール／将来の AI 生成、どちらから来たかは問わない）。
 * category は「自分の追加」に固定する——プール由来の元カテゴリー（例: emotions）よりも、
 * 検索して追加した語だと分かることをカテゴリー選択で優先する（設計意図どおり）。
 * 同じ cardId で再度呼ぶと addedAt が更新されるだけ（idempotent・エラーにはしない）。
 */
export async function addCard(courseId: CourseId, card: VocabCard): Promise<VocabCard> {
  const tagged: VocabCard = { ...card, category: REQUESTED_CATEGORY_KEY }
  const row: AddedCard = { cardId: tagged.id, courseId, addedAt: new Date().toISOString(), card: tagged }
  await db.addedCards.put(row)
  return tagged
}

/** 追加を取り消す（進捗行はここでは消さない——「単語一覧から外す」だけの操作にする）。 */
export async function removeAddedCard(cardId: string): Promise<void> {
  await db.addedCards.delete(cardId)
}
