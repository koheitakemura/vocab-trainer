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
      },
      manifest: {
        name: 'Vocab Trainer',
        short_name: 'Vocab',
        description: '語彙特化学習アプリ（サーバーレス）',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: './',
        icons: [],
      },
    }),
  ],
})
