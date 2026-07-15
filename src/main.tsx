import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { DesignGallery } from './design/DesignGallery'
import { ThemeGallery } from './design/ThemeGallery'
import { GrowthPreview } from './features/growth/GrowthPreview'
import './index.css'

// 新しい Service Worker が見つかったら自動更新（データパック更新時に旧キャッシュが
// 残り続けないようにする）。registerType:'autoUpdate' により、新SWが activate したら
// ライブラリ側が自動で1回リロードする（vite.config.ts の skipWaiting/clientsClaim と
// セットで機能する — どちらか片方だけでは新SWが waiting のまま反映されない不具合を確認済み）。
// onRegisteredSW で明示的に update() を呼び、ブラウザの更新チェックが最大24時間遅延する
// 既定挙動をバイパスして毎回即チェックする。
if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      void registration?.update()
    },
  })
}

// 進捗はローカルの IndexedDB だけに在る＝容量逼迫時にブラウザへ消されるのが最大の事故。
// persistent storage を一度リクエストしておくと自動削除の対象から外れる（拒否されても無害）。
if (navigator.storage?.persist) void navigator.storage.persist()

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
  if (hash.startsWith('#growth')) return <GrowthPreview />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
