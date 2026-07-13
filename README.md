# Vocab Trainer

語彙特化の学習アプリ（1エンジン × 複数コース）。各利用者が個人用ツールとして使う。

- **Kohei 用**: 英語 10k→30k ／ タガログ語 0→3k
- **メンバー用（フィリピンチーム）**: 日本語 0→3k / 3k→10k / 10k→30k（JLPTバッジ付き）

学習ロジック（FSRS-6 SRS・配置テスト・単語状態トラッキング・カバレッジ可視化）は全コース共通で、
違いは語彙データと表示言語だけ。

> フォルダ名 `Vocab_Trainer` は仮。正式名が決まったらリネーム。

## ドキュメント

- [PLAN.md](PLAN.md) — 機能計画（コース構成・データパイプライン・フェーズ計画・判断ログ）

## スタック

**サーバーレス（100% クライアントサイド）**。Vite + React + TypeScript の静的 SPA（PWA）／ ts-fsrs（MIT）／
IndexedDB ローカルファースト＋手動 JSON バックアップ（クラウド同期なし）。
配布は個人 GitHub の public リポジトリ → GitHub Pages（無料）：https://koheitakemura.github.io/vocab-trainer/
語彙データは再配布可能なオープンデータのみ（BCCWJ・jpdb 不使用）。音声は不採用、発音は表記（かな/IPA/アクセント付き）で伝える。
データパイプラインは Python ローカルバッチ（wordfreq・Sudachi・JMdict/CMUdict 変換等）で本体と分離。

## 状態

コースC（日本語 0→3k・3,075語）が実データで稼働中・GitHub Pagesで公開済み。学習ループ（Study Grid・ホバーでフリップ・3段階評価）と
All words 一覧、進捗の手動バックアップ/リストアまで実装済み。次は英語・タガログ語・日本語上級コースのデータパイプライン構築。
