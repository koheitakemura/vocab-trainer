import { useEffect, useState } from 'react'

type Mode = 'light' | 'dark'
const KEY = 'vocab-theme'

function initialMode(): Mode {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/**
 * ダーク（①濃紺）⇄ ライト（③）の切替。
 * 初回はシステム設定に追従、以後は localStorage に保存。描画前の確定は index.html の inline script。
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(initialMode)

  useEffect(() => {
    document.documentElement.dataset.theme = mode
    try {
      localStorage.setItem(KEY, mode)
    } catch {
      /* localStorage 不可でも動作は継続 */
    }
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', mode === 'light' ? '#f5f7fb' : '#0b1120')
  }, [mode])

  return (
    <button
      className="link theme-toggle"
      onClick={() => setMode((m) => (m === 'dark' ? 'light' : 'dark'))}
      title={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label="Toggle theme"
    >
      {mode === 'dark' ? '☀ Light' : '🌙 Dark'}
    </button>
  )
}
