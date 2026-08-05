import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { BootBrand } from './brand/Logo'
import { startProgressSync } from './store/sync'
import { startSnapshotSync } from './store/snapshot'
import './index.css'

/**
 * ハッシュ／`/admin` でしか到達しない画面は遅延ロードする。
 *
 * 静的 import だと、学習しかしない利用者にも管理者画面・デザイン確認画面のコードが
 * 毎回配られる（実測: 単一チャンク 539KB のうち管理者系 25KB＋デザイン系 12KB）。
 * これらは本体アプリからは一切参照されない独立した部分木なので、分離しても
 * 学習画面の挙動には影響しない。名前付き export なので default へ詰め替えて渡す。
 */
const DesignGallery = lazy(() => import('./design/DesignGallery').then((m) => ({ default: m.DesignGallery })))
const ThemeGallery = lazy(() => import('./design/ThemeGallery').then((m) => ({ default: m.ThemeGallery })))
const GrowthPreview = lazy(() => import('./features/growth/GrowthPreview').then((m) => ({ default: m.GrowthPreview })))
const BrandPreview = lazy(() => import('./brand/BrandPreview').then((m) => ({ default: m.BrandPreview })))
const AdminScreen = lazy(() => import('./features/admin/AdminScreen').then((m) => ({ default: m.AdminScreen })))

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

// 端末移行用の進捗スナップショット（単語ごとの学習状態を丸ごと）。上記の集計値同期とは
// 完全に別のタイマー・別の db.meta キーで動く（snapshot.ts 参照。混ぜて事故を作らない）。
startSnapshotSync()

/**
 * 管理者画面はパス `/admin` でも開ける（Worker が index.html を返す）。
 * ハッシュ（`#admin`）だけだと **Cloudflare Access のログインを挟んだ瞬間に消える**——
 * `#` 以降はサーバーへ送られないため、ログイン後は必ず `/` に戻されてしまう。
 * パスならログインを経由しても保持されるので、ブックマークできるのはこちら。
 */
function isAdminPath(): boolean {
  return window.location.pathname.replace(/\/+$/, '').endsWith('/admin')
}

// `#design`=レイアウト比較 / `#tones`=カラートーン比較 / `#brand`=ロゴ確認 /
// `#admin` または /admin=管理者画面 / それ以外=本体アプリ。
// hashchange に反応（同一ドキュメントのハッシュ変更でも切り替わる）。
function Root() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 遅延ロード中は起動画面と同じ見た目にする（真っ白を挟まない）。App 本体は静的 import
  // なので Suspense には入らない＝学習画面の表示タイミングは従来と1msも変わらない。
  const lazyScreen = (screen: React.ReactNode) => (
    <Suspense
      fallback={
        <div className="boot">
          <BootBrand />
        </div>
      }
    >
      {screen}
    </Suspense>
  )

  if (hash.startsWith('#design')) return lazyScreen(<DesignGallery />)
  if (hash.startsWith('#tones')) return lazyScreen(<ThemeGallery />)
  if (hash.startsWith('#growth')) return lazyScreen(<GrowthPreview />)
  if (hash.startsWith('#brand')) return lazyScreen(<BrandPreview />)
  if (hash.startsWith('#admin') || isAdminPath()) return lazyScreen(<AdminScreen />)
  // 管理者画面への入口は CourseScreen のフッター（Backup/Restore と同じ行）に表示する
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
