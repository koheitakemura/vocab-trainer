const KEY = 'vocab-autoplay'

/** 新規カード表示時の自動再生（listening-first, PLAN §4.1）の on/off。既定 ON。 */
export function getAutoplayPref(): boolean {
  try {
    const v = localStorage.getItem(KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

export function setAutoplayPref(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* localStorage 不可でも動作は継続 */
  }
}
