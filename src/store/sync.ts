import { db } from './db'
import { localDate } from './progress'
import { buildGrowth } from '../features/growth/growth'
import type { DailyStat } from '../types'

/**
 * 進捗サマリのサーバー同期（管理者が全員の進捗を一覧できるようにするための片方向送信）。
 *
 * 設計の約束：
 * - **送るのは集計値だけ**。語ごとの学習状態・回答履歴・例文は送らない（サーバーには「コース別に
 *   何語始めて何語覚えたか」しか無い）。
 * - **学習の一次データは今も端末の IndexedDB**。この送信は要約のミラーであって、
 *   失敗しても・サーバーが無くても学習は一切壊れない（オフライン・未デプロイでも黙って諦める）。
 * - 表示名だけはサーバー→端末の一方向で戻す。登録・変更は管理画面からのみ行い、
 *   端末側に編集 UI を持たせない（CourseScreen の name-badge はこの値を読むだけ）。
 */

/** 1コース分の送信内容（worker/types.ts の CourseProgressInput と対になる） */
export interface SyncCourse {
  courseId: string
  started: number
  known: number
  mastered: number
  reviews: number
  daysStudied: number
  streak: number
  longestStreak: number
  lastStudiedDate: string | null
}

/** base: './' で配信されるため、API の URL は常に現在のドキュメント基準で解決する */
export function apiUrl(path: string): string {
  return new URL(path, document.baseURI).toString()
}

/** Dexie の集計行から送信ペイロードを組み立てる（全語スキャンはしない＝コースが巨大でも軽い） */
export async function buildSyncPayload(): Promise<{ courses: SyncCourse[] }> {
  const [summaries, stats] = await Promise.all([db.summary.toArray(), db.dailyStats.toArray()])
  const today = localDate(new Date())

  const statsByCourse = new Map<string, DailyStat[]>()
  for (const s of stats) {
    const list = statsByCourse.get(s.courseId) ?? []
    list.push(s)
    statsByCourse.set(s.courseId, list)
  }

  const courses = summaries.map((s) => {
    const known = s.byGrade.good + s.byGrade.easy + s.burned
    const courseStats = statsByCourse.get(s.courseId) ?? []
    // ストリーク・延べ日数・累計レビューは成長タブと同じ計算を使う（数字が画面ごとに食い違わないように）
    const growth = buildGrowth(courseStats, { introduced: s.introduced, known, mastered: s.burned }, today)
    // 最終学習日＝レビュー実績がある最後の日（未来日付の行は成長タブ同様に無視する）
    const lastStudiedDate =
      courseStats
        .filter((d) => d.reviews > 0 && d.date <= today)
        .map((d) => d.date)
        .sort()
        .pop() ?? null
    return {
      courseId: s.courseId,
      started: s.introduced,
      known,
      mastered: s.burned,
      reviews: growth.reviews,
      daysStudied: growth.activeDays,
      streak: growth.currentStreak,
      longestStreak: growth.longestStreak,
      lastStudiedDate,
    }
  })

  return { courses }
}

/**
 * 管理者が設定した「その人が使えるコース」を端末へ反映する。
 * null / 空 は「制限なし（全コース）」の意味なので meta から消す。
 * 端末側に保存するのは**オフラインでも直前の割り当てで動かすため**（毎回サーバーに聞かない）。
 */
async function applyAllowedCourses(value: unknown): Promise<void> {
  const next = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  const current = await db.meta.get('allowedCourses')
  const currentList = Array.isArray(current?.value) ? (current.value as string[]) : []
  if (currentList.join(',') === next.join(',')) return
  if (next.length > 0) await db.meta.put({ key: 'allowedCourses', value: next })
  else await db.meta.delete('allowedCourses')
}

/** サーバーの表示名を端末へ反映（差分があるときだけ書く＝liveQuery の無駄な再描画を避ける） */
async function applyDisplayName(name: unknown): Promise<void> {
  if (typeof name !== 'string') return
  const current = await db.meta.get('displayName')
  const currentName = typeof current?.value === 'string' ? current.value : ''
  if (currentName === name) return
  if (name) await db.meta.put({ key: 'displayName', value: name })
  else await db.meta.delete('displayName')
}

let lastSyncAt = 0

/**
 * 1回同期する。失敗（オフライン・未デプロイ・未ログイン）は握りつぶす——
 * 学習アプリ本体はサーバー無しで完結する設計なので、ここで例外を投げて画面を壊してはいけない。
 */
export async function syncNow(): Promise<void> {
  try {
    const payload = await buildSyncPayload()
    const res = await fetch(apiUrl('api/sync'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
    })
    lastSyncAt = Date.now()
    if (!res.ok) return
    const data = (await res.json()) as { displayName?: unknown; allowedCourses?: unknown }
    await applyDisplayName(data.displayName)
    await applyAllowedCourses(data.allowedCourses)
  } catch {
    lastSyncAt = Date.now()
  }
}

const MIN_INTERVAL_MS = 60_000
const PERIODIC_MS = 10 * 60_000

function syncIfStale(): void {
  if (Date.now() - lastSyncAt < MIN_INTERVAL_MS) return
  void syncNow()
}

/**
 * 送信タイミングを仕掛ける（アプリ起動時に1回だけ呼ぶ）。
 * 起動直後・離脱時・滞在中は10分ごと。最短間隔60秒で連打を抑える。
 * 起動時は 3 秒待つ——コースデータ（数MB）の取得と帯域を奪い合わせないため。
 */
/**
 * 表示名と「使えるコース」だけを先に取りにいく（進捗の送信より軽い）。
 * 起動直後にコース一覧を正しく絞るため、3秒待つ本同期とは別に即座に呼ぶ。
 */
async function refreshEntitlements(): Promise<void> {
  try {
    const res = await fetch(apiUrl('api/me'), { credentials: 'same-origin' })
    if (!res.ok) return
    const data = (await res.json()) as { displayName?: unknown; allowedCourses?: unknown }
    await applyDisplayName(data.displayName)
    await applyAllowedCourses(data.allowedCourses)
  } catch {
    // オフライン等。端末に保存済みの直前の割り当てで動く
  }
}

export function startProgressSync(): void {
  void refreshEntitlements()
  window.setTimeout(() => void syncNow(), 3000)
  document.addEventListener('visibilitychange', () => {
    // タブを離れる/戻る両方で拾う（学習セッション終了直後の値をなるべく早く反映する）
    syncIfStale()
  })
  window.addEventListener('pagehide', () => syncIfStale())
  window.setInterval(() => {
    if (document.visibilityState === 'visible') syncIfStale()
  }, PERIODIC_MS)
}
