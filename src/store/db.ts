import Dexie, { type Table } from 'dexie'
import type { ReviewGrade } from '../srs/scheduler'
import type { CourseId, CourseSummary, DailyStat, MetaRow, WordProgress } from '../types'

/**
 * ローカルファーストの進捗ストア（IndexedDB）。
 * 各人の進捗はその端末に保存。サーバー同期なし。
 *
 * v2（2026-07-14）:
 * - summary: コース別の増分集計（ヘッダーが毎採点で progress 全行をスキャンしない基盤）
 * - dailyStats: 1コース×1日＝1行の追記型ログ（ゴール/ストリーク/成長曲線の共通基盤）
 * - meta: 小さな設定・状態の key-value
 * - progress から status 'new' の行を削除（「行が無い ＝ 未着手」に統一。
 *   旧実装は起動のたびに全 3,075 語分の行を作っており、初回 put ×3千件が最重量だった）
 */
export class VocabDB extends Dexie {
  progress!: Table<WordProgress, string>
  summary!: Table<CourseSummary, string>
  dailyStats!: Table<DailyStat, [string, string]>
  meta!: Table<MetaRow, string>

  constructor() {
    super('vocab-trainer')
    this.version(1).stores({
      // 主キー = cardId、インデックス = courseId / status
      progress: 'cardId, courseId, status',
    })
    this.version(2)
      .stores({
        progress: 'cardId, courseId, status',
        summary: 'courseId',
        dailyStats: '[courseId+date], courseId',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        // 未着手行は冗長なので削除（DB が語彙数ぶん膨らむのを止める）
        await tx.table('progress').where('status').equals('new').delete()
        // 残行からコース別サマリを一度だけ再集計（以後は recordReview が増分更新）
        const rows = (await tx.table('progress').toArray()) as WordProgress[]
        await tx.table('summary').bulkPut(summarize(rows))
      })
  }
}

/** 採点内訳のゼロ値。ReviewGrade を増減するときはここだけ直せば全利用箇所に効く。 */
export function emptyByGrade(): Record<ReviewGrade, number> {
  return { good: 0, easy: 0, hard: 0, again: 0 }
}

/** コース別サマリのゼロ値 */
export function emptySummary(courseId: CourseId): CourseSummary {
  return { courseId, introduced: 0, byGrade: emptyByGrade() }
}

/** progress 行の配列からコース別サマリを組み立てる（移行・復元・自己修復で共用） */
export function summarize(rows: WordProgress[]): CourseSummary[] {
  const byCourse = new Map<string, CourseSummary>()
  for (const r of rows) {
    if (r.status === 'new') continue
    let s = byCourse.get(r.courseId)
    if (!s) {
      s = emptySummary(r.courseId)
      byCourse.set(r.courseId, s)
    }
    s.introduced++
    if (r.lastGrade) s.byGrade[r.lastGrade]++
  }
  return [...byCourse.values()]
}

export const db = new VocabDB()
