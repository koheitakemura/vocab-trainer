/**
 * 語彙数 → 日常会話の被覆率（%）の目安テーブル。
 * 根拠: PLAN §4.1 のマイルストーン（0-1k ≈ 会話の80-85% / 1k-3k ≈ 95%）と
 * 語彙被覆率研究（Nation 2006・Adolphs & Schmitt 2003）の慣用値。
 * コーパスは主に英語の話し言葉研究由来のため日本語への適用は近似
 * ——表示は必ず「~」付き・整数丸めで、精密な数値として見せないこと。
 */
const ANCHORS: Array<[words: number, pct: number]> = [
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

/** 語数から被覆率（%）を線形補間で返す（整数丸め） */
export function coverageAt(words: number): number {
  if (words <= 0) return 0
  const last = ANCHORS[ANCHORS.length - 1]
  if (words >= last[0]) return last[1]
  for (let i = 1; i < ANCHORS.length; i++) {
    const [w1, p1] = ANCHORS[i]
    if (words <= w1) {
      const [w0, p0] = ANCHORS[i - 1]
      return Math.round(p0 + ((words - w0) / (w1 - w0)) * (p1 - p0))
    }
  }
  return last[1]
}
