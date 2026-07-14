/**
 * localStorage の安全ラッパー（プライベートモード・容量超過・無効化でも本体を止めない）。
 * 演出の既読管理・バッジのラチェット等、消えても学習データに影響しない状態にだけ使う。
 * 学習データ本体は IndexedDB（store/db.ts）が正。
 */
export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 保存できなくても続行 */
  }
}
