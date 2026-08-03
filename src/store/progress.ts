import { db, emptySummary, isExtraCardId, summarize } from './db'
import { BURN_STABILITY_DAYS, gradeCard, newCard, retrievabilityOf, State, type ReviewGrade } from '../srs/scheduler'
import { isKnownRow, isPromotionToKnown, type GradeLevel } from '../srs/levels'
import type { CourseId, DailyStat, MetaRow, VocabCard, WordProgress } from '../types'

/** ローカル日付の YYYY-MM-DD（dailyStats のキー。深夜0時跨ぎは端末のローカル時刻基準） */
export function localDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function emptyDailyStat(courseId: CourseId, date: string): DailyStat {
  return { courseId, date, reviews: 0, newStarted: 0, promotions: 0, dueReviews: 0, dueAgain: 0, knownTotal: 0 }
}

/** recordReview の結果（演出・メーター更新の判定材料） */
export interface ReviewOutcome {
  /** この採点が初採点だったか */
  wasNew: boolean
  /** 上書き前の直近の採点 */
  prevGrade?: ReviewGrade
  /** この採点で卒業（Mastered）に到達したか（金色スパークルの判定） */
  burnedNow: boolean
  /** 推定語彙数（retrievability 合計）のこの採点による増分。ヘッダーが O(1) で追従するために返す */
  deltaR: number
}

/**
 * レビュー結果を記録し、FSRS 状態と WordStatus を更新。
 * 進捗行が無い語（未着手）はここで初めて行を作る（v2: 「行が無い ＝ new」）。
 * stability が BURN_STABILITY_DAYS を超えた known カードは 'burned'（卒業）へ昇格し、
 * 以後レビューキューに出ない（PLAN §3.3。3万語スケールのキュー管理の要）。
 * 同一トランザクションでコース別サマリ（ヘッダー用）と日次ログを増分更新する
 * ＝毎採点の追加コストは O(1)（語彙数に比例する処理を持たない）。
 *
 * levelCounts は呼び出し側（useStudyBoard）が確定させた値をそのまま書く——
 * ここで独自に += しない（このページを表示している間に同じカードを再採点しても、
 * 丸は最後の1回分だけが残る。連打のたびに += すると押した回数だけ丸が増えてしまうため）。
 *
 * baseline はこのページを開いた時点（＝このセッションで初めて触る前）の進捗行。
 * FSRS の次回スケジュール（nextFsrs）は必ず baseline を起点に計算する——p.fsrs
 * （直前の押下で書き込まれた「途中経過」）を起点にすると、同じページ表示中の
 * 採点しなおしが毎回スケジュールに積み重なってしまう（例：Fuzzy→I know と押し直すと、
 * I know を1回だけ押した場合と違う復習日になる）。baseline が無い（このコースで初めて
 * 触るカード）ときは通常どおり p.fsrs（＝新規カードの初期値）を使う。
 * それ以外（wasNew／prevGrade／prevR など）は直前の書き込みを見る従来どおりの計算で正しい
 * （サマリの増減分・推定語彙数の増分がそれぞれの呼び出しの差分を足し込む設計のため）。
 */
export async function recordReview(
  card: VocabCard,
  grade: ReviewGrade,
  levelCounts: Record<GradeLevel, number>,
  baseline?: WordProgress,
): Promise<ReviewOutcome> {
  const now = new Date()
  const today = localDate(now)
  return db.transaction('rw', db.progress, db.summary, db.dailyStats, async () => {
    const existing = await db.progress.get(card.id)
    const p: WordProgress = existing ?? {
      cardId: card.id,
      courseId: card.courseId,
      status: 'new',
      fsrs: newCard(now),
      reviewedCount: 0,
    }
    const wasNew = p.status === 'new'
    const wasBurned = p.status === 'burned'
    const prevGrade = p.lastGrade
    const prevR = retrievabilityOf(p.fsrs, now)
    // 実測定着率の分母判定：期限が来ていた復習カードを「今日はじめて」採点したときだけ数える
    // （再採点・同セッションの again 再出題で二重計上しない）。
    const isDueReview =
      !wasNew &&
      p.fsrs.state === State.Review &&
      p.fsrs.due.getTime() <= now.getTime() &&
      (!p.lastReviewedAt || localDate(new Date(p.lastReviewedAt)) !== today)
    const nextFsrs = gradeCard(baseline ? baseline.fsrs : p.fsrs, grade, now)
    // ステータスはボタンの意味に合わせる：Studying/Fuzzy=学習中、I know=習得（十分安定なら卒業）。
    // FSRS の state ではなく採点で決める＝短期ステップ無効化後も All words の色分けが直感どおりになる。
    const status: WordProgress['status'] =
      grade === 'again' || grade === 'hard'
        ? 'learning'
        : nextFsrs.stability >= BURN_STABILITY_DAYS
          ? 'burned'
          : 'known'
    const burnedNow = status === 'burned' && !wasBurned
    await db.progress.put({
      ...p,
      fsrs: nextFsrs,
      status,
      lastGrade: grade,
      reviewedCount: p.reviewedCount + 1,
      levelCounts,
      lastReviewedAt: now.toISOString(),
    })

    // コース別サマリの増分更新（ヘッダーのメーターはこの1行だけを読む）。
    // 卒業済みは byGrade でなく burned に数える（内訳の Mastered セグメント）。
    // 自分で追加した語（isExtraCardId）はここに混ぜない——コースのレベル感を示す数字を
    // 汚さないため（docs/word-request-design.md §4）。progress/dailyStats への記録は
    // 通常どおり行う＝学習盤面・単語一覧・ストリークには変わらず反映される。
    const s = (await db.summary.get(card.courseId)) ?? emptySummary(card.courseId)
    if (!isExtraCardId(card.id)) {
      if (wasNew) s.introduced++
      if (wasBurned) {
        if (s.burned > 0) s.burned--
      } else if (prevGrade && s.byGrade[prevGrade] > 0) {
        s.byGrade[prevGrade]--
      }
      if (status === 'burned') s.burned++
      else s.byGrade[grade]++
      await db.summary.put(s)
    }

    // 日次ログの追記（1コース×1日＝1行）
    const d = (await db.dailyStats.get([card.courseId, today])) ?? emptyDailyStat(card.courseId, today)
    d.reviews++
    if (wasNew) d.newStarted++
    if (isPromotionToKnown(prevGrade, grade)) d.promotions++
    if (isDueReview) {
      d.dueReviews++
      if (grade === 'again') d.dueAgain++
    }
    d.knownTotal = s.byGrade.good + s.byGrade.easy + s.burned
    await db.dailyStats.put(d)

    return { wasNew, prevGrade, burnedNow, deltaR: retrievabilityOf(nextFsrs, now) - prevR }
  })
}

/** 語彙の実力スナップショット（推定語彙数＋既習語 id の集合） */
export interface VocabSnapshot {
  /** retrievability 合計＝推定語彙数のベースライン */
  estKnown: number
  /** 「I know」扱いの語（good/easy or 卒業）の cardId 集合。コーチ文の解禁判定に使う */
  knownIds: Set<string>
}

/**
 * コース全 progress 行を1回スキャンして実力スナップショットを作る。
 * 画面マウント時に1回だけ呼ぶ（コスト∝学習済み語数）。以後の追従は
 * recordReview が返す deltaR／採点結果の増分更新で O(1)（毎採点の再スキャンはしない）。
 */
export async function vocabSnapshot(courseId: CourseId, now: Date = new Date()): Promise<VocabSnapshot> {
  const rows = await db.progress.where('courseId').equals(courseId).toArray()
  let sum = 0
  const knownIds = new Set<string>()
  for (const r of rows) {
    // 推定語彙数（メーター下の被覆率/depth の元になる）から自分の追加語を除く
    // （docs/word-request-design.md §4）。学習盤面での既習判定（knownIds）自体は
    // コーチ文の解禁材料に過ぎず害がないためこのループごと丸ごとスキップする。
    if (isExtraCardId(r.cardId)) continue
    sum += retrievabilityOf(r.fsrs, now)
    if (isKnownRow(r)) knownIds.add(r.cardId)
  }
  return { estKnown: sum, knownIds }
}

/**
 * サマリ行が無ければ progress から再集計して作る（旧データ・想定外状態からの自己修復）。
 * 判定と書き込みを同一トランザクションで行う＝並行する recordReview の増分を
 * 古い再集計値で上書きしない（lost update 防止）。
 */
export async function ensureSummary(courseId: CourseId): Promise<void> {
  await db.transaction('rw', db.progress, db.summary, async () => {
    if (await db.summary.get(courseId)) return
    const rows = await db.progress.where('courseId').equals(courseId).toArray()
    const s = summarize(rows).find((x) => x.courseId === courseId) ?? emptySummary(courseId)
    await db.summary.put(s)
  })
}

/** 学習進捗が「いまのコースの語彙」と噛み合っているかの診断結果 */
export interface ProgressIntegrity {
  /** そのコースの progress 行数 */
  rows: number
  /** 学習記録はあるのに、いまのコースに存在しない cardId の数（＝どの単語にも紐付いていない記録） */
  orphans: number
  /**
   * 記録が「cardId が付け替わる前の世代」のものである疑い。
   * true のとき、覚えた判定が**別の単語に付いている**可能性がある。
   */
  staleEpoch: boolean
}

/** 「この端末の進捗はどの世代のものか」を覚えておく meta のキー */
function epochKey(courseId: CourseId): string {
  return `progressEpoch:${courseId}`
}

/**
 * 進捗の健全性を1回だけ調べる（コースを開いたときに1回。liveQuery で常時監視しない）。
 *
 * recordReview の O(1) を壊さないため、ここは「開いたときのコスト」に閉じ込める。
 * 進捗が1行も無いコースでは、その場で現在の世代を刻んで以後の誤検知を防ぐ
 * （新規に始めた人に「記録が信頼できません」と出さないため）。
 */
export async function checkProgressIntegrity(
  courseId: CourseId,
  idEpoch: number,
  presentCardIds: Set<string>,
): Promise<ProgressIntegrity> {
  // 自分で追加した語（isExtraCardId）は cardId レジストリの世代管理と無関係
  // （内容ハッシュ由来のIDでそもそも付け替わらない）。ここに混ぜると「コースに存在しない
  // cardId」として孤児カウントに誤って計上され、無用な警告バナーが出る。
  const rows = (await db.progress.where('courseId').equals(courseId).toArray()).filter(
    (r) => !isExtraCardId(r.cardId),
  )
  if (rows.length === 0) {
    await acknowledgeEpoch(courseId, idEpoch)
    return { rows: 0, orphans: 0, staleEpoch: false }
  }
  const stored = await db.meta.get(epochKey(courseId))
  // 記録があるのに刻印が無い＝刻印を始める前からの利用者。旧世代とみなす
  const storedEpoch = typeof stored?.value === 'number' ? stored.value : 1
  const orphans = rows.reduce((n, r) => (presentCardIds.has(r.cardId) ? n : n + 1), 0)
  const staleEpoch = storedEpoch < idEpoch
  // 世代が一致しているなら、刻印だけ更新して以後は何も出さない
  if (!staleEpoch && stored === undefined) await acknowledgeEpoch(courseId, idEpoch)
  return { rows: rows.length, orphans, staleEpoch }
}

/** 現在の世代を「確認済み」として刻む（リセットしても・そのまま使うことを選んでも呼ぶ） */
export async function acknowledgeEpoch(courseId: CourseId, idEpoch: number): Promise<void> {
  await db.meta.put({ key: epochKey(courseId), value: idEpoch })
}

/** 進捗を JSON 文字列に書き出す（手動バックアップ／端末移行用）。v2 = 日次ログ・設定も同梱 */
export async function exportProgress(): Promise<string> {
  const [progress, dailyStats, meta] = await Promise.all([
    db.progress.toArray(),
    db.dailyStats.toArray(),
    db.meta.toArray(),
  ])
  // 機械可読のバックアップなので整形しない（3万語スケールでは整形がサイズ・時間とも約2倍になる）
  return JSON.stringify({
    format: 'vocab-trainer/progress',
    version: 2,
    exportedAt: new Date().toISOString(),
    progress,
    dailyStats,
    meta,
  })
}

/**
 * JSON をインポートして進捗を復元。取り込んだ学習済みカード行数を返す。
 * 復元 = **バックアップ時点への完全復帰（全置換）**。v1 のバックアップは全語彙分の行を
 * 含んでいたため実質全置換で動いており、その意味論を維持する（マージにすると
 * 「昨日のバックアップに戻したのに今日の誤操作が残る」事故になる）。
 * v1（progress のみ）も v2（dailyStats/meta 同梱）も受け付ける。
 */
export async function importProgress(json: string): Promise<number> {
  const parsed = JSON.parse(json) as { progress?: WordProgress[]; dailyStats?: DailyStat[]; meta?: MetaRow[] }
  // v1 バックアップには未着手（status 'new'）行が含まれる。v2 は「行が無い ＝ new」なので捨てる。
  const items = (parsed.progress ?? [])
    .filter((p) => p.status !== 'new')
    .map((p) => ({ ...p, fsrs: reviveFsrsDates(p.fsrs) }))
  await db.transaction('rw', db.progress, db.summary, db.dailyStats, db.meta, async () => {
    await Promise.all([db.progress.clear(), db.summary.clear(), db.dailyStats.clear(), db.meta.clear()])
    await db.progress.bulkPut(items)
    if (parsed.dailyStats?.length) await db.dailyStats.bulkPut(parsed.dailyStats)
    if (parsed.meta?.length) await db.meta.bulkPut(parsed.meta)
    // サマリは派生データなので取り込まず、取り込んだ行から作り直す（ドリフト防止）
    await db.summary.bulkPut(summarize(items))
  })
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

/** デモ/開発用：このコースの進捗・日次ログを全消去して初期状態に戻す。サマリはゼロ値を書く
 *（「サマリ行は常に存在し正しい」という不変条件をストア層で保つ＝読む側の特例を不要にする） */
export async function resetCourseProgress(courseId: CourseId): Promise<void> {
  await db.transaction('rw', db.progress, db.summary, db.dailyStats, async () => {
    await db.progress.where('courseId').equals(courseId).delete()
    await db.dailyStats.where('courseId').equals(courseId).delete()
    await db.summary.put(emptySummary(courseId))
  })
}
