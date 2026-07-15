import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base: './' = 相対パス。ローカルでも GitHub Pages のプロジェクトページ
// （https://<user>.github.io/<repo>/）でもそのまま動く。ルーターは使わず単一ページ。
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // index.html への自動登録スクリプト注入をやめ、main.tsx で明示的に登録する
      // （即時アップデートチェックのため。二重登録を避ける）。
      injectRegister: false,
      // 開発時は SW を無効（スクショ・HMR を邪魔しない）。本番ビルドでのみ生成。
      devOptions: { enabled: false },
      // registerType:'autoUpdate' はクライアント側の登録スクリプトの挙動を決めるだけで、
      // 生成される SW 自体が install 時に自動で skipWaiting するとは限らない（実際、
      // 明示しないと SKIP_WAITING メッセージ待ちのままになり、更新が反映されず旧キャッシュが
      // 残り続ける不具合を確認した）。skipWaiting+clientsClaim を明示して即時有効化する。
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // アプリシェル（js/css/html/アイコン）のみ precache。コース語彙データ（json）は
        // ここに含めない＝含めると全訪問者に全コース分（5コースなら数MB）を無条件配信してしまう。
        // コース JSON は下の runtimeCaching で「選んだコースだけ」オンデマンドにキャッシュする。
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            // data/courses/ 配下の json（manifest/meta/categories/coach-sentences/words-*）。
            // オリジン・base パスに依存しないよう pathname 内の位置で判定する。
            urlPattern: ({ url }) => /\/data\/courses\/.*\.json$/.test(url.pathname),
            // コース内容は稀に更新されるため、オンライン時は常に最新を取りにいき
            // オフライン時のみキャッシュへフォールバックする（NetworkFirst）。
            handler: 'NetworkFirst',
            options: {
              cacheName: 'course-data',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Vocab Trainer',
        short_name: 'Vocab',
        description: '語彙特化学習アプリ（サーバーレス）',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: './',
        // icons が空だとインストール条件を満たさず「ホーム画面に追加」プロンプトが出ない。
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
