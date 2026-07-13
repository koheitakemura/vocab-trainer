import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { DesignGallery } from './design/DesignGallery'
import { ThemeGallery } from './design/ThemeGallery'
import './index.css'

// 新しい Service Worker が見つかったら自動更新（データパック更新時に旧キャッシュが
// 残り続けないようにする）。ユーザー操作を挟まないサイレント更新。
// - onRegisteredSW で明示的に update() を呼び、ブラウザの更新チェックが最大24時間
//   遅延する既定挙動をバイパスして毎回即チェックする
// - controllerchange（新SWが実際に制御を握った瞬間）で1回だけ自動リロードし、
//   「キャッシュを手動でクリアしないと新しい内容が反映されない」状態を無くす
if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      void registration?.update()
    },
  })

  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}

// `#design`=レイアウト比較 / `#tones`=カラートーン比較 / それ以外=本体アプリ。
// hashchange に反応（同一ドキュメントのハッシュ変更でも切り替わる）。
function Root() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (hash.startsWith('#design')) return <DesignGallery />
  if (hash.startsWith('#tones')) return <ThemeGallery />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
