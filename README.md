# Vocab Trainer

語彙特化の学習アプリ（1エンジン × 複数コース）。各利用者が個人用ツールとして使う。

- **Kohei 用**: 英語 10k→30k ／ タガログ語 0→3k
- **メンバー用（フィリピンチーム）**: 日本語 0→3k / 3k→10k / 10k→30k（JLPTバッジ付き）

学習ロジック（FSRS-6 SRS・配置テスト・単語状態トラッキング・カバレッジ可視化）は全コース共通で、
違いは語彙データと表示言語だけ。

## ドキュメント

- [PLAN.md](PLAN.md) — 機能計画（コース構成・データパイプライン・フェーズ計画・判断ログ）
- [docs/brand.md](docs/brand.md) — ロゴ・アイコン・色（資産の使い分けと再生成手順）
- [docs/admin-console.md](docs/admin-console.md) — 管理者画面（利用者の登録・削除／進捗確認）の設計とセットアップ手順
- [docs/new-courses-plan.md](docs/new-courses-plan.md) — 新コース検討（カタカナ語／基本漢字）。未着手の検討資料

## スタック

**学習部分はクライアントサイド完結**。Vite + React + TypeScript の静的 SPA（PWA）／ ts-fsrs（MIT）／
学習の進捗は IndexedDB ローカルファースト＋手動 JSON バックアップ（学習ロジックはサーバーに依存せず、オフラインでも完結）。
配信は Cloudflare Workers（静的アセット）＋ Cloudflare Access のログインゲート：https://vocab-trainer.takemura-kohei.workers.dev/
同じ Worker に管理者用の API（`/api/*`）と D1 を持たせ、**利用者の登録・削除**と**コース別の進捗サマリの集約**だけを行う
（語ごとの学習データは送らない。詳細＝ [docs/admin-console.md](docs/admin-console.md)）。
語彙データは再配布可能なオープンデータのみ（BCCWJ・jpdb 不使用）。音声は不採用、発音は表記（かな/IPA/アクセント付き）で伝える。
データパイプラインは Python ローカルバッチ（wordfreq・Sudachi・JMdict/CMUdict 変換等）で本体と分離。

## 状態

コースC（日本語 0→3k・3,075語）が実データで稼働中・GitHub Pagesで公開済み。学習ループ（Study Grid・ホバーでフリップ・3段階評価）と
All words 一覧、進捗の手動バックアップ/リストアまで実装済み。次は英語・タガログ語・日本語上級コースのデータパイプライン構築。
