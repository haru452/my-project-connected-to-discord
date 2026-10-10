# diary-reminder（日記リマインダー）

毎日決まった時刻（初期設定: 日本時間 20:00）に、**その日の日記が書かれていなければ**、Discord にメッセージを送る小さなサーバー（Cloudflare Workers）。

## 仕組み

```
アプリ ──(日記の添削に成功)──► POST /ping  「今日は書いた」 ──► Worker が記録（KV）
                                                                    │
毎日 20:00（cron）────────────────────────────────────────────────► 今日の記録があるか確認
                                                                    │ なければ
                                                                    ▼
                                                          Discord の Webhook に通知
```

- 昨日まで連続していて、今日まだ書いていない場合は、「◯日連続が今夜で途切れます」という文面になる
- 同じ日に2回は送らない
- 無料プランの範囲で動く（1日あたりの実行は数回のみ）

## 必要なもの

- Cloudflare のアカウント（無料）
- Node.js（wrangler を動かすため）
- Discord の Webhook URL（日記の送信に使っているものと同じでも、別チャンネル用の新しいものでもよい）

## セットアップ

このフォルダ（`diary-reminder-worker`）で、順番に実行する。

### 1. wrangler を入れてログインする

```
npm install -D wrangler
npx wrangler login
```

ブラウザが開くので、Cloudflare のアカウントで許可する。

### 2. 合言葉（APP_SECRET）を決める

アプリと Worker で共有する、長めのランダムな文字列を決める（例: パスワード生成ツールで作った32文字）。他人に知られると、誰でも「書いた」と偽って連絡できてしまう。

### 3. 記録を保存する場所（KV）を作る

```
npx wrangler kv namespace create DIARY_KV
```

表示された `id` を、`wrangler.toml` の `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` と置き換える。

### 4. 秘密の値を登録する

```
npx wrangler secret put APP_SECRET
npx wrangler secret put DISCORD_WEBHOOK_URL
```

それぞれ、聞かれたら値を貼り付けて Enter。

通知が確実に鳴るよう、自分にメンションしたい場合は、Discord の「開発者モード」をオンにして、自分のユーザーIDをコピーし、次も登録する（任意）。

```
npx wrangler secret put DISCORD_USER_ID
```

### 5. 公開する

```
npx wrangler deploy
```

最後に表示される `https://diary-reminder.<あなたの名前>.workers.dev` が、アプリに設定する URL。

### 6. 動作を確認する

Discord にすぐ届くか試す（`<URL>` と `<APP_SECRET>` は置き換える）。

```
curl -X POST <URL>/test -H "Authorization: Bearer <APP_SECRET>"
```

Discord にメッセージが届けば成功。

## GitHub と連携してデプロイする場合

上の「セットアップ」の代わりに、GitHub に push すると自動で公開される形にもできる。

### Cloudflare に必要なファイル

このフォルダの中身だけでよい。**Unity のファイルは不要**。

| ファイル | 役割 |
|---|---|
| `src/index.js` | Worker 本体 |
| `wrangler.toml` | 設定（名前、毎日の実行時刻、KV の場所） |
| `.gitignore` | 秘密の値や一時ファイルを、うっかり push しないための設定 |
| `README.md` | この手順書（なくても動く） |

### 手順

1. **KV を作る。** Cloudflare のダッシュボードで KV の名前空間を作り（例: `DIARY_KV`）、表示された ID を `wrangler.toml` の `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` と置き換える。コマンドで作る場合は `npx wrangler kv namespace create DIARY_KV`。
2. **GitHub に push する。** `wrangler.toml` の `name`（初期値 `diary-reminder`）は、次の手順で付ける Worker の名前と同じにしておく。
3. **Cloudflare と GitHub を繋ぐ。** ダッシュボードの Workers の画面で **Import a repository**（Get started）を選び、GitHub を認可して、リポジトリを選ぶ。
   - **Worker の名前:** `wrangler.toml` の `name` と**同じ**にする（違うとビルドが失敗する）。
   - **Root directory:** このフォルダだけのリポジトリなら `/`。Unity プロジェクトなどと同じリポジトリに入れた場合は `/diary-reminder-worker`（`wrangler.toml` があるフォルダ）。
   - **Deploy command:** 初期値の `npx wrangler deploy` のままでよい。Build command は空でよい。
4. **秘密の値を登録する。** 作成された Worker の **Settings > Variables and Secrets** で、種類を **Secret** にして追加する。
   - `APP_SECRET`
   - `DISCORD_WEBHOOK_URL`
   - `DISCORD_USER_ID`（任意）

   秘密の値は GitHub には置かない（`wrangler.toml` にも書かない）。
5. **反映を確認する。** 秘密の値を足した後に反映されていなければ、ビルドの一覧から **Retry build**。今後は、`main` ブランチに push するたびに自動で再公開される。
6. **動作を確認する。** 「セットアップ」の手順 6 と同じ `curl` で `/test` を呼び、Discord に届けば成功。

### 注意

- **リポジトリは、Unity プロジェクトとは別にするのがおすすめ。** Unity のシーンやプレハブには、Inspector に入力した API キーや Webhook URL が保存される。同じリポジトリに入れて公開すると、漏れる。
- 公開リポジトリにする場合は、push する前に、`APP_SECRET` や Webhook URL がファイルに入っていないか確認する。

## アプリ側の設定

Unity の `DiaryManager` の Inspector にある次の欄に入力する。

| 項目 | 入れる値 |
|---|---|
| Send Reminder Ping | ON |
| Reminder Worker Url | 手順 5 の URL（末尾の `/` は不要） |
| Reminder Secret | 手順 2 の合言葉（`APP_SECRET` と同じ値） |

## 時刻・タイムゾーンを変える

- **通知の時刻:** `wrangler.toml` の `crons` を変更して、もう一度 `npx wrangler deploy`。cron は UTC で書く（日本時間 − 9 時間）。
- **タイムゾーン:** `wrangler.toml` の `TIMEZONE` を変更する（例: `America/New_York`）。

## 注意

- 「今日書いた」という連絡は、日記の**添削に成功したとき**に、アプリから送られる。そのときスマホがネットに繋がっていないと、連絡が届かず、書いたのにリマインドが来ることがある。
- 日付は、アプリと Worker で同じ（日本時間）の日付で比べている。アプリの `Day Boundary Hour` を設定していても、夜のリマインド時刻には影響しない。
- `APP_SECRET` と `DISCORD_WEBHOOK_URL` は、Git などで公開しない。`wrangler.toml` には書かない（`secret put` で登録する）。
