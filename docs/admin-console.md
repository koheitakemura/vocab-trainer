# 管理者画面（利用者の登録・削除／進捗確認）

管理者（Kohei）が **①利用者のログイン許可を追加・削除** し、**②各自の進捗を一覧** するための画面。
URL は本番の学習アプリと同じホストの **`/admin`**：<https://vocab-trainer.takemura-kohei.workers.dev/admin>

> `#admin`（ハッシュ）でも開けるが、**Cloudflare Access のログインを挟むと `#` 以降は消える**ため
> （フラグメントはサーバーへ送られず、ログイン後は `/` に戻される）、ブックマークするなら `/admin` を使うこと。

> **状態（2026-07-31）**：デプロイ済みで、**進捗の閲覧は使える**。
> 利用者の**登録・削除だけ**は Secret `CF_API_TOKEN` 待ち。詳細＝[§4](#4-セットアップ手順)。

---

## 1. 設計の要点

このアプリは「アカウント無し・進捗は端末内 IndexedDB・サーバー無し」で作られてきた（PLAN.md 判断ログ#6）。
管理者画面は**その方針を最小限だけ変える**：

| 項目 | どうしたか | なぜ |
|---|---|---|
| 本人確認 | **Cloudflare Access の JWT を検証するだけ**。パスワード・セッション・ユーザーテーブルは自作しない | Access が既にログインを済ませている。認証の自作はバグと脆弱性の温床 |
| 誰がログインできるか | **Zero Trust の Emails 型リストが唯一の真実**。管理画面の「登録／削除」はそのリストの append / remove そのもの | D1 の名簿だけ書き換えても「ログインできる／できない」は変わらない。実体を触る |
| 進捗 | **コース別の集計値だけ**を D1 に送る（語ごとの学習データ・回答履歴・例文は送らない） | 管理者に必要なのは「どれだけ進んだか」だけ。送る情報は最小にする |
| 学習の一次データ | **これまで通り端末の IndexedDB**。D1 はその要約のミラー | D1 が消えても・オフラインでも・Worker が落ちても学習は 1 ミリも壊れない |
| 表示名 | サーバー → 端末の一方向。登録・変更は管理画面だけ | 端末側に編集 UI を持たせない（誰の端末か管理者が決められる） |

### 何が「削除」されるのか

| 操作 | Access 許可リスト | D1 の名簿 | 進捗データ | 元に戻せるか |
|---|---|---|---|---|
| **アクセス取消** | 削除 | `status='removed'` | **残る** | 「再登録」で戻る |
| **完全削除** | 削除 | 行ごと削除 | **消える** | 戻せない |

どちらも実行時に既存ログインセッションの失効も試みる（成功しなければ、既存セッションはセッション有効期間まで残る旨を画面に出す）。

---

## 2. 構成

```
worker/                       Cloudflare Worker（/api/* だけを処理し、他は静的アセットへ委譲）
  index.ts                    ルーティング・エラー→HTTPステータス変換
  auth.ts                     Access JWT の検証（jose）・管理者判定
  cf.ts                       Cloudflare API（許可リストの取得/追加/削除・セッション失効）
  store.ts                    D1 のスキーマとクエリ
  validate.ts                 受信データの検証・正規化
src/store/sync.ts             端末 → サーバの進捗サマリ送信（失敗しても学習に影響しない）
src/features/admin/           管理画面 UI（AdminScreen.tsx / adminApi.ts / admin.css）
```

`main.tsx` の既存ハッシュルーター（`#design` / `#tones` / `#growth`）に `#admin` を 1 行足しただけ。
学習画面のコード（`CourseScreen.tsx` や `index.css`）には触っていない。

### API

| メソッド | パス | 誰が | 何を |
|---|---|---|---|
| GET | `/api/me` | 全員 | 自分のメール・管理者かどうか・表示名 |
| POST | `/api/sync` | 全員 | 自分の進捗サマリを送る（停止中は 403） |
| GET | `/api/admin/users` | 管理者 | 名簿＋進捗＋許可リストとの突き合わせ |
| POST | `/api/admin/users` | 管理者 | 登録（許可リスト追加 → 名簿追加の順） |
| PATCH | `/api/admin/users` | 管理者 | 表示名・メモの更新 |
| POST | `/api/admin/users/remove` | 管理者 | アクセス取消／完全削除（`{email, purge}`） |
| GET | `/api/admin/log` | 管理者 | 直近の管理操作ログ |

削除だけ DELETE ではなく POST + 本文なのは、**メールアドレスをクエリ文字列に載せないため**
（Cloudflare の invocation log はリクエスト URL をそのまま記録するので、完全削除した人のメールがログに残ってしまう）。

D1 のテーブルは Worker が初回リクエスト時に `CREATE TABLE IF NOT EXISTS` で用意する（マイグレーション作業は不要）。

---

## 3. セキュリティ上の決めごと

- **`Cf-Access-Authenticated-User-Email` ヘッダは信用しない。** 必ず `Cf-Access-Jwt-Assertion` の JWT を
  jose で検証し（issuer・audience・署名・期限・`algorithms: ['RS256']`）、payload の email だけを本人とする。
- **CSRF 対策として、状態を変える要求は同一オリジンのものだけ受ける**（`Sec-Fetch-Site` / `Origin` を検証）。
  本人確認は Access の Cookie 依存なので、**JWT 検証だけでは CSRF を防げない**——管理者がログイン中に
  攻撃者のページを開くと、そこからのクロスサイト POST にも Cookie が付き、Access が正規の JWT を注入してしまう。
  加えて `Content-Type: application/json` を必須にして、preflight の起きない
  `enctype="text/plain"` フォーム POST を JSON として受けないようにしている。
- **`POLICY_AUD`（Access の AUD タグ）未設定なら全リクエストを 500 で落とす**（fail closed）。
  設定漏れのまま「誰でも管理APIを叩ける」状態にはならない。
- **管理者判定はサーバー側のみ。** 画面の出し分けは見た目の話で、非管理者が直接 API を叩いても 403。
- **自分自身と `ADMIN_EMAILS` のメールは削除できない**（管理画面から締め出されると復旧が
  Cloudflare ダッシュボード作業になるため）。
- **名簿の行を「無ければ作る」は、いま許可リストに載っている人にだけ行う。** 無条件に作ると、
  完全削除した人の Access セッションが生きている間に端末の自動同期で行が作り直され、
  消したはずの利用者と進捗が復活する（セッション失効はベストエフォートなので窓が開き得る）。
- **本文サイズは `content-length` ヘッダでなく実バイト数で判定する**（ヘッダは送らない/壊すだけで無効化できる）。
- **API レスポンスは `Cache-Control: no-store`。** 個人データを CDN・Service Worker・ブラウザに残さない。
- **開発用バイパス（`ALLOW_DEV_AUTH` / `DEV_EMAIL` / `CF_MODE=simulate`）は `POLICY_AUD` 未設定のときだけ有効。**
  本番には必ず AUD が入っているので、仮にダッシュボードで誤って有効化しても JWT 検証は外れない。
  加えて `.dev.vars` は gitignore 済みかつ `wrangler deploy` の成果物に含まれない。
- **このリポジトリは public** なので、メール・アカウントID・リストID・APIトークンは
  `wrangler.jsonc` の `vars` に書かず、**すべて Worker Secret** に入れる（通常のデプロイでは消えない。
  ただし §4 の「一度だけ踏んだ罠」に注意——assets 専用 Worker に初めて `main` を足したデプロイでだけ消えた）。
  `.gitignore` は `.dev.vars*` と `.env*` の両方を除外している（wrangler は `.env` も読むため）。
- **API トークンは絞れない。** Zero Trust リストの編集には「Zero Trust: 編集」が要り、これはアカウント配下の
  Gateway ポリシー・リストを全部触れる権限を含む。したがって**このプロジェクト専用に発行し、他と共用せず、
  期限を切って定期的に作り直す**こと。

### 実測で確認済みの挙動（2026-07-30／31・ローカル `wrangler dev`）

| 試したこと | 結果 |
|---|---|
| 非管理者が `/api/admin/*`（一覧・追加・更新・削除・ログ） | すべて **403** |
| 非管理者が自分の `/api/sync` | **200**（自分の進捗のみ） |
| `status='removed'` の人が `/api/sync` | **403**・既存データは書き換わらない |
| **完全削除した人が生きたセッションで `/api/sync`** | **403**・`/api/me` は `unregistered`・**行は復活しない** |
| トークン無し | **401** |
| 偽の `Cf-Access-Authenticated-User-Email` ヘッダ | **401** |
| `alg=none` の自作 JWT／偽 Cookie | **401** |
| `POLICY_AUD` 未設定 | **500**（fail closed） |
| **`POLICY_AUD` あり × `ALLOW_DEV_AUTH=true` の誤設定** | **401**（開発バイパスは効かない） |
| **クロスサイトの `text/plain` フォーム POST（CSRF の手口）** | **403** |
| **`Origin` が別サイトの POST（`Sec-Fetch-Site` 無し）** | **403** |
| **同一オリジンの正規 fetch（ブラウザ実操作）** | **200**（追加・取消とも画面から成功） |
| `Content-Type` が `application/json` でない POST | **400** |
| 250KB の本文（`content-length` あり／chunked で無し） | どちらも **400** |
| 自分自身・管理者の削除 | **400**（拒否） |
| 学習アプリ本体・存在しない JSON の 404 フォールバック | Worker 導入前と同じ（**200 / 404**） |

---

## 4. セットアップ手順

### 済んでいること（2026-07-31 に実施）

| 項目 | 状態 |
|---|---|
| D1 `vocab-trainer-db`（APAC）作成・`wrangler.jsonc` に反映 | ✅ 完了 |
| Secret `TEAM_DOMAIN` / `POLICY_AUD` / `ADMIN_EMAILS` / `CF_ACCOUNT_ID` | ✅ 設定済み |
| main へ push・自動デプロイ・Access ゲートの維持を実測 | ✅ 完了 |
| Secret `CF_API_TOKEN` | ❌ **未設定＝登録・削除だけ使えない**（進捗確認は使える） |
| Access の Cookie を SameSite=Strict にする | ❌ 未実施（任意・下の⑤-b） |

### ⚠️ 一度だけ踏んだ罠：assets 専用 Worker → main 付き Worker への移行で Secret が消える

Cloudflare の公式ドキュメントは「Secrets are never deleted by a deployment」と書いているが、
**`main` を持たない静的アセット専用 Worker に初めて `main` を足してデプロイしたときだけ、既存の Secret が全部消えた**（実測）。
以後の通常デプロイでは消えない（手動デプロイを1回走らせて4つとも残存することを確認済み）。
この移行は済んでいるので、今後は気にしなくてよい。**移行と同時期に Secret を入れる場合はデプロイ後に入れ直すこと。**

### ① D1 データベースを作る（済）
`wrangler d1 create vocab-trainer-db` で作成し、`wrangler.jsonc` の `database_id` に記入済み。

### ② Access アプリの AUD タグ（済）
ダッシュボードを見なくても取れる——**未ログインでアプリの URL を叩いたときのリダイレクト先**に含まれている：

```bash
curl -sI https://vocab-trainer.takemura-kohei.workers.dev/ | grep -i location
# → .../cdn-cgi/access/login/...?kid=<AUDタグ>&meta=<JWT>
#   JWT のペイロードの "aud" が AUD タグ（64桁の16進数）
```

ダッシュボードから見る場合は **Zero Trust → Access → Applications → vocab-trainer → Overview → Application Audience (AUD) Tag**。

### ③ ログイン許可リストの ID（**通常は不要**）
Worker が実行時に自動で解決する——**メール型のリストが1つだけならそれを使う**。
今のアカウントはメール型リストが「Vocab Trainer User」1つだけなので、**何も設定しなくてよい**。

メール型リストを複数持つようになったら、そのときだけ次のどちらかを Secret に足す：

- `CF_ACCESS_EMAIL_LIST_NAME` … 対象リストの名前（例 `Vocab Trainer User`）※こちらが簡単
- `CF_ACCESS_EMAIL_LIST_ID` … UUID（Zero Trust → 再利用可能なコンポーネント → リスト → 対象を開いて URL 末尾）

複数あるのに指定が無いときは、間違ったリストを書き換えないよう**エラーにして止まる**（画面に候補名が出る）。

### ④ API トークンを作る
1. ダッシュボード右上のプロフィール → **API トークン** → **トークンを作成** → **カスタムトークン**
2. 権限（アカウント単位）:
   - **Zero Trust : 編集**（許可リストの追加・削除に必要）
   - **Access: Organizations Revoke**（あれば付ける。削除時に既存セッションを即失効させるため。無くても動く）
3. アカウントリソースは自分のアカウントのみに限定して作成 → **表示されたトークンをコピー**（再表示不可）

### ⑤ Worker に Secret を入れる
`wrangler secret put <名前>`（値は標準入力）か、**Workers & Pages → vocab-trainer → Settings → Variables and Secrets** で
**すべて Secret（暗号化）として**追加する。`vars` には書かない（このリポジトリは public のため）。

| 名前 | 値 | 状態 |
|---|---|---|
| `TEAM_DOMAIN` | `https://divine-bread-a024.cloudflareaccess.com` | ✅ |
| `POLICY_AUD` | ②の AUD タグ | ✅ |
| `ADMIN_EMAILS` | 管理者のメール（複数ならカンマ区切り） | ✅ |
| `CF_ACCOUNT_ID` | `wrangler whoami` で分かるアカウントID | ✅ |
| `CF_API_TOKEN` | ④のトークン | ❌ **未設定＝ここだけ残っている** |
| `CF_ACCESS_EMAIL_LIST_ID` / `CF_ACCESS_EMAIL_LIST_NAME` | 任意（③参照。メール型リストが1つなら不要） | — |

`CF_API_TOKEN` が未設定の間、管理画面は**進捗の閲覧はできる**が、登録・削除ボタンは無効になり
「⚠️ ログイン許可リストに接続できません」の帯が出る（設計どおりのフォールバック）。

### ⑤-b Access の Cookie を SameSite=Strict にする（CSRF の二重防御）
Zero Trust → Access → Applications → vocab-trainer → **Settings → Cookie settings → SameSite Attribute** を
**Strict**（最低でも Lax）に変更。Worker 側でも同一オリジン検証をしているので必須ではないが、
既定の `None` は「クロスサイトの要求にもログイン Cookie が付く」設定なので、閉じておくに越したことはない。

### ⑥ デプロイして確認
1. main に push すると GitHub Actions が自動デプロイする
2. `https://vocab-trainer.takemura-kohei.workers.dev/#admin` を開く
3. 自分のメールと利用者一覧が出れば成功。「⚠️ ログイン許可リストに接続できません」が出たら
   ⑤の値（特に `CF_ACCOUNT_ID` / `CF_ACCESS_EMAIL_LIST_ID` / `CF_API_TOKEN`）を見直す

---

## 5. ローカルでの動かし方

```bash
cp .dev.vars.example .dev.vars   # 初回のみ。値は開発用のダミーでよい
npm run build                    # wrangler dev は dist/ を配信するので先にビルド
npm run dev:worker               # http://127.0.0.1:8787 で Worker ごと起動
```

`.dev.vars` の `ALLOW_DEV_AUTH="true"` により Access を経由せず `DEV_EMAIL` の人として動く。
`CF_MODE="simulate"` の間は Cloudflare の実 API を叩かず、D1 の名簿を許可リストとみなす。

`npm run dev`（Vite だけ）でも学習画面は従来どおり動く。`/api/*` は存在しないので同期は黙って失敗するだけ。

---

## 6. 運用上の注意

- **利用者には「進捗が管理者に見えること」を伝える。** 送っているのはコース別の集計値だけだが、
  誰がどれだけ学習したかは管理者から見える。
- **Access の無料枠は 50 人まで。** 超える場合は課金プランが要る。
- **D1 の無料枠**（1日 500万行読み・10万行書き・5GB）に対して、利用者数十人・10分間隔の同期は桁違いに小さい。
- 削除は許可リストから消えるだけで、**既にログイン中のセッションはセッション有効期間まで生きる**
  （失効APIが成功すれば即時。画面に結果が出る）。
