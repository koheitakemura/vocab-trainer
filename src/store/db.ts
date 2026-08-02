import Dexie, { type Table } from 'dexie'
import type { ReviewGrade } from '../srs/scheduler'
import type { AddedCard, CourseId, CourseSummary, DailyStat, MetaRow, WordProgress } from '../types'

/**
 * 検索して追加した語の cardId かどうか（docs/word-request-design.md §3）。
 * `<courseId>-x<8桁16進>` 形式で、パイプラインの連番採番（id_registry.py・数字サフィックスのみ）
 * とは非交差——`isValidVocabulary` 相当の判定は要らず、パターンだけで安全に見分けられる。
 * コース本体の「レベル感を示す数字」（メーター・目盛り・被覆率・管理画面送信）から
 * 追加語を除外するための唯一の判定関数。summarize() と store/progress.ts の両方から使う。
 */
export function isExtraCardId(cardId: string): boolean {
  return /-x[0-9a-f]{8}$/.test(cardId)
}

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
  addedCards!: Table<AddedCard, string>

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
    // v3: CourseSummary に burned（卒業数）を追加。スキーマは同じでデータ形状だけ変わるため、
    // 既存サマリ行を一度だけ作り直す（増分更新とのドリフトもここでリセットされる）。
    this.version(3).upgrade(async (tx) => {
      const rows = (await tx.table('progress').toArray()) as WordProgress[]
      await tx.table('summary').clear()
      await tx.table('summary').bulkPut(summarize(rows))
    })
    // v4: addedCards（検索して自分で追加した語。docs/word-request-design.md）。
    // 主キー=cardId、courseId で絞り込めるようインデックスを付ける（progress 系と同じ形）。
    this.version(4).stores({
      addedCards: 'cardId, courseId',
    })
  }
}

/** 採点内訳のゼロ値。ReviewGrade を増減するときはここだけ直せば全利用箇所に効く。 */
export function emptyByGrade(): Record<ReviewGrade, number> {
  return { good: 0, easy: 0, hard: 0, again: 0 }
}

/** コース別サマリのゼロ値 */
export function emptySummary(courseId: CourseId): CourseSummary {
  return { courseId, introduced: 0, byGrade: emptyByGrade(), burned: 0 }
}

/** progress 行の配列からコース別サマリを組み立てる（移行・復元・自己修復で共用） */
export function summarize(rows: WordProgress[]): CourseSummary[] {
  const byCourse = new Map<string, CourseSummary>()
  for (const r of rows) {
    if (r.status === 'new') continue
    // 自分で追加した語はコースの「レベル感を示す数字」（メーター・被覆率・管理画面送信）に
    // 混ぜない（docs/word-request-design.md §4）。学習盤面・単語一覧では変わらず使える——
    // ここは progress → summary の集計だけを絞る。
    if (isExtraCardId(r.cardId)) continue
    let s = byCourse.get(r.courseId)
    if (!s) {
      s = emptySummary(r.courseId)
      byCourse.set(r.courseId, s)
    }
    s.introduced++
    // 卒業済みは byGrade でなく burned に数える（メーター内訳の Mastered セグメント）
    if (r.status === 'burned') s.burned++
    else if (r.lastGrade) s.byGrade[r.lastGrade]++
  }
  return [...byCourse.values()]
}

export const db = new VocabDB()
