import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { DesignGallery } from './design/DesignGallery'
import { ThemeGallery } from './design/ThemeGallery'
import { GrowthPreview } from './features/growth/GrowthPreview'
import { AdminScreen } from './features/admin/AdminScreen'
import { startProgressSync } from './store/sync'
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

// 進捗サマリ（コース別の集計値だけ）をサーバーへ片方向送信する。管理者が全員の進捗を
// 一覧できるようにするためのもので、失敗しても学習側は一切影響を受けない（sync.ts 参照）。
startProgressSync()

/**
 * 管理者画面はパス `/admin` でも開ける（Worker が index.html を返す）。
 * ハッシュ（`#admin`）だけだと **Cloudflare Access のログインを挟んだ瞬間に消える**——
 * `#` 以降はサーバーへ送られないため、ログイン後は必ず `/` に戻されてしまう。
 * パスならログインを経由しても保持されるので、ブックマークできるのはこちら。
 */
function isAdminPath(): boolean {
  return window.location.pathname.replace(/\/+$/, '').endsWith('/admin')
}

// `#design`=レイアウト比較 / `#tones`=カラートーン比較 / `#admin` または /admin=管理者画面 /
// それ以外=本体アプリ。hashchange に反応（同一ドキュメントのハッシュ変更でも切り替わる）。
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
  if (hash.startsWith('#admin') || isAdminPath()) return <AdminScreen />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
