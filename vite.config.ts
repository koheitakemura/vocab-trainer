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
        // 既定は js/css/html のみ＝語彙データ（data/courses/**.json）が precache されず
        // オフラインで起動できなかった。JSON とアイコンも含めて完全オフライン化する
        // （現状 計約1.3MB・帯ファイルは各400KB程度で workbox の2MB/ファイル上限にも余裕）。
        // 複数コース時代に「使わないコースまで配る」問題が出たら runtimeCaching へ移行する。
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
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
