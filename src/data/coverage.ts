import type { Course } from '../types'

/**
 * コース別の「進捗の意味づけ」を返す層（PLAN §4.1-4.3 / Phase 1.5.4）。
 *
 * 帯によって進捗の意味が根本的に違うため、単一の被覆率% では表せない:
 *   - rail  (0-3k)  … 日常会話の語彙被覆率% が意味を持つ（会話ドメイン）
 *   - cloze (3k-10k)… 書き言葉の語彙被覆率% が意味を持つ（読解が目的＝書き言葉ドメイン）
 *   - calibrate-mine (10k-30k) … 語数が増えても被覆率は頭打ちで、価値が depth
 *       （コロケーション正答率）へ移る帯（PLAN §4.3）→ 被覆率% でなく「語数＋深度」の2軸
 *
 * 呼び出し側は course.type で分岐する新API `courseProgress()` を使う（下の JSDoc 参照）。
 * 旧 `coverageAt(words)` は「0-3k 会話ドメイン」専用の下位関数として残す——3000語で95%頭打ちは
 * 0-3k 会話では正しい挙動だが、高帯コースに流用すると意味を成さない（これが 1.5.4 で汎用化する動機）。
 */

/** 被覆率の対象領域。UI のラベル出し分け用（実テキスト・i18n は呼び出し側が持つ） */
export type CoverageDomain = 'conversation' | 'written'

/** 被覆率% が意味を持つ帯（rail=0-3k / cloze=3k-10k）の進捗 */
export interface CoveragePctProgress {
  mode: 'coverage-pct'
  /** 語彙被覆率%（整数丸め・近似値）。UI では必ず「~」付きで見せる（精密な数値に見せない） */
  pct: number
  domain: CoverageDomain
}

/**
 * 較正型（calibrate-mine=10k-30k）の2軸進捗。この帯は語数の限界効用が下がり depth へ価値が移る。
 * depth = コロケーション正答率(0-100)。cloze/較正エンジンの採点が実データ源だが未供給のため、
 * いまは常に null。呼び出し側は `depth == null` を「深度データなし＝非表示」として安全に扱うこと。
 */
export interface SizeDepthProgress {
  mode: 'size-depth'
  words: number
  depth: number | null
}

export type CourseProgress = CoveragePctProgress | SizeDepthProgress

/** 語数→被覆率% のアンカー（線形補間の節点）。表示は必ず近似（「~」付き）として扱う */
type Anchor = [words: number, pct: number]

/**
 * 0-3k=日常会話の被覆率。根拠: PLAN §4.1（0-1k ≈ 会話の80-85% / 1k-3k ≈ 95%）＋
 * 語彙被覆率研究（Nation 2006・Adolphs & Schmitt 2003）の慣用値。コーパスは主に英語の
 * 話し言葉研究由来のため他言語への適用は近似。
 */
const CONVERSATION_ANCHORS: Anchor[] = [
  [0, 0],
  [100, 45],
  [250, 60],
  [500, 72],
  [1000, 85],
  [1500, 89],
  [2000, 92],
  [2500, 94],
  [3000, 95],
]

/**
 * 3k-10k=書き言葉の被覆率。0-3k と違い会話でなく書き言葉が対象（この帯の学習目的＝読解）。
 * 根拠: PLAN §4.2「8-9k語で書き言葉98%被覆」＋Nation 2006 の帯別書き言葉被覆。数値は近似。
 * 8000語以降は98%で緩やかに頭打ち＝これ以上は語数より depth の帯（10k-30k）へ移る前段。
 */
const WRITTEN_ANCHORS: Anchor[] = [
  [0, 0],
  [1000, 78],
  [2000, 85],
  [3000, 89],
  [5000, 93],
  [8000, 98],
  [10000, 98],
]

/** アンカー表を語数で線形補間（表の範囲外は端点でクランプ・整数丸め） */
function interpolate(anchors: Anchor[], words: number): number {
  if (words <= anchors[0][0]) return anchors[0][1]
  const last = anchors[anchors.length - 1]
  if (words >= last[0]) return last[1]
  for (let i = 1; i < anchors.length; i++) {
    const [w1, p1] = anchors[i]
    if (words <= w1) {
      const [w0, p0] = anchors[i - 1]
      return Math.round(p0 + ((words - w0) / (w1 - w0)) * (p1 - p0))
    }
  }
  return last[1]
}

/**
 * 語数 → 日常会話の被覆率%（0-3k 会話ドメイン専用の下位関数）。
 * 3000語以上は95%で頭打ち＝0-3k 会話では正しい挙動。高帯コースには使わず `courseProgress()` を使う。
 * ※ Phase 1.5.4 の配線後は非 export 化して courseProgress() 経由に一本化してよい。
 */
export function coverageAt(words: number): number {
  if (words <= 0) return 0
  return interpolate(CONVERSATION_ANCHORS, words)
}

/**
 * コース種別に応じた進捗表現を返す（1.5.4 汎用化の中心 API）。
 *
 * 呼び出し側（次ステージで配線）はこの戻り値の `mode` で分岐する:
 *   - 'coverage-pct' → `~{pct}% of {会話 or 書き言葉}`（`domain` でラベルを出し分け）
 *   - 'size-depth'   → `{words} words`（`depth != null` なら `· depth {depth}%` を併記。null は非表示）
 *
 * 現行の呼び出し元がどう変わるべきか（配線は別エージェント担当）:
 *   - CourseScreen.tsx:287    現在の推定既知語数 est を渡す（メーター下の被覆率/2軸表示）
 *   - features/coach.ts:112   MEMORY_BRAG。estKnown を渡す（rail 以外では文面自体の出し分けが要る）
 *   - stats/StatsPanel.tsx:104 est を渡す（サマリ行の被覆率/2軸表示）
 *   - features/MilestoneChip / MilestoneOverlay も coverageAt を使用（節目の目標語数を渡している）。
 *     これらは 0-3k レール専用 UI のため、当面 rail でのみ表示する想定でよいが配線時に要確認。
 *
 * @param course type を持つコース（course をそのまま渡してよい）
 * @param words  対象語数（現在の推定既知語数、または節目の目標語数）
 * @param depth  コロケーション正答率(0-100)。calibrate-mine のみ意味を持つ。未供給は null
 */
export function courseProgress(
  course: Pick<Course, 'type'>,
  words: number,
  depth: number | null = null,
): CourseProgress {
  switch (course.type) {
    case 'calibrate-mine':
      // 10k-30k: 語数の限界効用が下がる帯。被覆率% でなく語数＋深度（PLAN §4.3）。
      return { mode: 'size-depth', words: Math.max(0, Math.round(words)), depth }
    case 'cloze':
      // 3k-10k: 読解が目的＝書き言葉の被覆率で意味づける（3000語で頭打ちにしない）。
      return { mode: 'coverage-pct', pct: interpolate(WRITTEN_ANCHORS, words), domain: 'written' }
    case 'rail':
    default:
      // 0-3k: 会話の被覆率（既存 ja-0-3k の表示を維持）。
      return { mode: 'coverage-pct', pct: coverageAt(words), domain: 'conversation' }
  }
}
