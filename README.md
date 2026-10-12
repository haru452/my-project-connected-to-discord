# diary-reminder（日記リマインダー）

英語日記アプリ [Learningapp](https://github.com/haru452/Learningapp) で使っている、**日記を書き忘れた日に Discord へ通知する**小さなサーバー（Cloudflare Workers）です。

毎日決まった時刻（日本時間 20:00）に、**その日の日記が書かれていなければ** Discord にメッセージを送ります。

📝 アプリ全体の解説記事（Qiita）：[Unity で「話した英語を AI が添削してくれる」英語日記アプリを作った](https://qiita.com/haru452/items/8656d7d15db5d20c7b41)

## 仕組み

```
アプリ ──(日記の添削に成功)──► POST /ping 「今日は書いた」 ──► Worker が記録（KV）
                                                                    │
cron-job.org ──(毎日 20:00)──► POST /check ────────────────► 今日の記録があるか確認
                                                                    │ なければ
                                                                    ▼
                                                          Discord の Webhook に通知
```

- 昨日まで連続していて、今日まだ書いていない場合は、「◯日連続が今夜で途切れます」という文面になる
- 同じ日に2回は送らない
- 無料プランの範囲で動く（1日あたりの実行は数回のみ）

> 最初は Cloudflare の Cron Trigger（`wrangler.toml` の `crons`）だけで毎日動かしていましたが、安定して動かないことがあったため、外部サービスの [cron-job.org](https://cron-job.org/en/) から `/check` を呼ぶ形にしています。Cron Trigger の設定も残してありますが、同じ日に2回は送らないので、両方動いても通知が重なることはありません。

## エンドポイント

すべて `POST` で、`Authorization: Bearer <APP_SECRET>` が必要です。

| パス | 内容 |
|---|---|
| `/ping` | アプリが「今日の日記を書いた」と連絡する。本文：`{"date": "2026-10-10", "streak": 7}` |
| `/check` | 毎日の判定を今すぐ行う（cron-job.org から呼ぶ）。`/check?dry=1` なら送信せず、判定の結果だけ返す |
| `/status` | 記録の状態を JSON で返す（アプリからの連絡が届いているかの確認用） |
| `/test` | 状態に関係なく、リマインドをすぐ Discord に送る（動作確認用） |

## 必要なもの

- Cloudflare のアカウント（無料）
- Node.js（wrangler を動かすため）
- Discord の Webhook URL（日記の送信に使っているものと同じでも、別チャンネル用の新しいものでもよい）
- [cron-job.org](https://cron-job.org/en/) のアカウント（無料）

## セットアップ

このリポジトリのフォルダで、順番に実行します。

### 1. wrangler を入れてログインする

```
npm install -D wrangler
npx wrangler login
```

ブラウザが開くので、Cloudflare のアカウントで許可する。

### 2. 合言葉（APP_SECRET）を決める

アプリ・Worker・cron-job.org で共有する、長めのランダムな文字列を決める（例：パスワード生成ツールで作った32文字）。他人に知られると、誰でも「書いた」と偽って連絡できてしまう。

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

最後に表示される `https://diary-reminder.<あなたの名前>.workers.dev` が、アプリと cron-job.org に設定する URL。

### 6. 動作を確認する

Discord にすぐ届くか試す（`<URL>` と `<APP_SECRET>` は置き換える）。

```
curl -X POST <URL>/test -H "Authorization: Bearer <APP_SECRET>"
```

Discord にメッセージが届けば成功。

### 7. cron-job.org で毎日の実行を設定する

1. [cron-job.org](https://cron-job.org/en/) にログインし、**CREATE CRONJOB** を押す。
2. 次のように設定する。

| 項目 | 設定 |
|---|---|
| URL | `<URL>/check` |
| Execution schedule | 毎日 20:00（タイムゾーンは `Asia/Tokyo`） |
| Request method（ADVANCED タブ） | `POST` |
| Headers（ADVANCED タブ） | Key：`Authorization`、Value：`Bearer <APP_SECRET>` |

3. 保存したら、**TEST RUN** で動作を確かめる。今日まだ日記を書いていなければ、Discord に通知が届く。

> `APP_SECRET` を変えたときは、Cloudflare・アプリ・cron-job.org の3か所すべてを変更する。

## GitHub と連携してデプロイする場合

上の「セットアップ」の手順 1・3〜5 の代わりに、GitHub に push すると自動で公開される形にもできる。

### Cloudflare に必要なファイル

| ファイル | 役割 |
|---|---|
| `src/index.js` | Worker 本体 |
| `wrangler.toml` | 設定（名前、Cron Trigger の時刻、KV の場所） |
| `.gitignore` | 秘密の値や一時ファイルを、うっかり push しないための設定 |
| `README.md` | この手順書（なくても動く） |

### 手順

1. **KV を作る。** Cloudflare のダッシュボードで KV の名前空間を作り（例：`DIARY_KV`）、表示された ID を `wrangler.toml` の `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` と置き換える。コマンドで作る場合は `npx wrangler kv namespace create DIARY_KV`。
2. **GitHub に push する。** `wrangler.toml` の `name`（初期値 `diary-reminder`）は、次の手順で付ける Worker の名前と同じにしておく。
3. **Cloudflare と GitHub を繋ぐ。** ダッシュボードの Workers の画面で **Import a repository**（Get started）を選び、GitHub を認可して、リポジトリを選ぶ。
   - **Worker の名前:** `wrangler.toml` の `name` と**同じ**にする（違うとビルドが失敗する）。
   - **Root directory:** `/`
   - **Deploy command:** 初期値の `npx wrangler deploy` のままでよい。Build command は空でよい。
4. **秘密の値を登録する。** 作成された Worker の **Settings > Variables and Secrets** で、種類を **Secret** にして追加する。
   - `APP_SECRET`
   - `DISCORD_WEBHOOK_URL`
   - `DISCORD_USER_ID`（任意）

   秘密の値は GitHub には置かない（`wrangler.toml` にも書かない）。
5. **反映を確認する。** 秘密の値を足した後に反映されていなければ、ビルドの一覧から **Retry build**。今後は、`main` ブランチに push するたびに自動で再公開される。
6. **動作を確認し、cron-job.org を設定する。** 「セットアップ」の手順 6・7 と同じ。

## アプリ側の設定

アプリ（[Learningapp](https://github.com/haru452/Learningapp)）の `Assets/Resources/ApiSecrets.json` に書く。このファイルは GitHub には上げない。

```json
{
  "reminderWorkerUrl": "手順 5 の URL（末尾の / は不要）",
  "reminderSecret": "手順 2 の合言葉（APP_SECRET と同じ値）"
}
```

Unity の Inspector には入力しない（シーンファイルに保存され、コミットすると公開されてしまうため）。

## 時刻・タイムゾーンを変える

- **通知の時刻:** cron-job.org のスケジュールを変更する。Cloudflare の Cron Trigger も使う場合は、`wrangler.toml` の `crons` も変更して `npx wrangler deploy`（cron は UTC で書く。日本時間 − 9 時間）。
- **タイムゾーン:** `wrangler.toml` の `TIMEZONE` を変更する（例：`America/New_York`）。

## 注意

- 「今日書いた」という連絡は、日記の**添削に成功したとき**に、アプリから送られる。そのときスマホがネットに繋がっていないと、連絡が届かず、書いたのにリマインドが来ることがある。
- 日付は、アプリと Worker で同じ（日本時間）の日付で比べている。アプリの `Day Boundary Hour` を設定していても、夜のリマインド時刻には影響しない。
- `APP_SECRET` と `DISCORD_WEBHOOK_URL` は、Git などで公開しない。`wrangler.toml` には書かない（`secret put` で登録する）。

## 関連リポジトリ

| リポジトリ | 内容 |
|---|---|
| [Learningapp](https://github.com/haru452/Learningapp) | アプリ本体（Unity） |
| [database_learnApp](https://github.com/haru452/database_learnApp) | データベース（Supabase）と Web 版 |
