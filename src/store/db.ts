import Dexie, { type Table } from 'dexie'
import type { WordProgress } from '../types'

/**
 * ローカルファーストの進捗ストア（IndexedDB）。
 * 各人の進捗はその端末に保存。サーバー同期なし。
 */
export class VocabDB extends Dexie {
  progress!: Table<WordProgress, string>

  constructor() {
    super('vocab-trainer')
    this.version(1).stores({
      // 主キー = cardId、インデックス = courseId / status
      progress: 'cardId, courseId, status',
    })
  }
}

export const db = new VocabDB()
