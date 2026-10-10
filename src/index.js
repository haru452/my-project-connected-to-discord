// Diary reminder Worker
//
//  POST /ping  : アプリが「今日の日記を書いた」と連絡する  { "date": "2026-10-10", "streak": 7 }
//  POST /test  : 状態に関係なく、リマインドをすぐ Discord に送る (動作確認用)
//  cron        : 毎日決まった時刻に、今日の日記が書かれていなければ Discord に通知する
//
// どちらの POST も  Authorization: Bearer <APP_SECRET>  が必要。

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ルートアクセス（トップページ）の処理を先頭に追加する場合
    if (url.pathname === "/") {
      return new Response("Diary Reminder Worker is running.");
    }

    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }
    // ...以降のコード
    if (!(await isAuthorized(request, env))) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (url.pathname === "/ping") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response("Bad JSON", { status: 400 });
      }
　　　// 例: index.js の fetch 関数内に追加

      const date = String(body.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return new Response("Bad date", { status: 400 });
      }
      const streak = Number.isInteger(body.streak) && body.streak >= 0 ? body.streak : 0;

      // 日付が古い連絡(遅れて届いたもの)で、新しい記録を上書きしない
      const state = await readState(env);
      if (!state.lastDate || date >= state.lastDate) {
        await env.DIARY_KV.put("state", JSON.stringify({ lastDate: date, streak }));
      }
      return new Response("ok");
    }

    if (url.pathname === "/test") {
      try {
        const today = todayInTimezone(env);
        await sendReminder(env, await readState(env), today);
        return new Response("sent");
      } catch (e) {
        // 原因が分かるメッセージを返す (動作確認用)
        return new Response("Failed: " + (e && e.message ? e.message : String(e)), { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAndRemind(env));
  },
};

// ------------------------------------------------------------
// Reminder
// ------------------------------------------------------------
async function checkAndRemind(env) {
  const today = todayInTimezone(env);
  const state = await readState(env);

  // 今日はもう書いている
  if (state.lastDate === today) return;

  // 同じ日に二重送信しない (cron の再実行対策)
  if ((await env.DIARY_KV.get("reminded")) === today) return;

  await sendReminder(env, state, today);
  await env.DIARY_KV.put("reminded", today);
}

async function sendReminder(env, state, today) {
  const yesterday = addDays(today, -1);

  let text;
  if (state.lastDate === yesterday && state.streak > 0) {
    // 昨日まで続いている → 今日書かないと途切れる
    text =
      "\u{1F4D3} Reminder: you haven't written today's diary yet.\n" +
      `Your **${state.streak}-day streak** ends tonight if you skip. Take a minute to speak your diary!`;
  } else {
    text = "\u{1F4D3} Reminder: you haven't written today's diary yet. Take a minute to speak your diary!";
  }

  // DISCORD_USER_ID があれば、その人にだけメンションして通知が鳴るようにする
  const userId = env.DISCORD_USER_ID;
  const payload = userId
    ? { content: `<@${userId}> ${text}`, allowed_mentions: { users: [String(userId)] } }
    : { content: text, allowed_mentions: { parse: [] } };

  const response = await fetch(getWebhookUrl(env), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status} ${await response.text()}`);
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
const DISCORD_HOSTS = ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"];

// Webhook URL が Discord のものか確認してから使う。
// (workers.dev など別の URL を登録してしまうと、Cloudflare のエラー 1042 になるため)
function getWebhookUrl(env) {
  const raw = String(env.DISCORD_WEBHOOK_URL || "").trim();
  if (!raw) {
    throw new Error("DISCORD_WEBHOOK_URL is not set. Add it as a Secret in the Worker settings.");
  }

  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("DISCORD_WEBHOOK_URL is not a valid URL.");
  }

  if (u.protocol !== "https:" || !DISCORD_HOSTS.includes(u.hostname) || !u.pathname.startsWith("/api/webhooks/")) {
    throw new Error(
      "DISCORD_WEBHOOK_URL must look like https://discord.com/api/webhooks/<id>/<token> " +
        `(the registered URL points to host: ${u.hostname}).`
    );
  }
  return u.toString();
}

async function readState(env) {
  const raw = await env.DIARY_KV.get("state");
  if (!raw) return { lastDate: null, streak: 0 };
  try {
    const s = JSON.parse(raw);
    return { lastDate: s.lastDate ?? null, streak: s.streak ?? 0 };
  } catch {
    return { lastDate: null, streak: 0 };
  }
}

// 指定タイムゾーン (既定: Asia/Tokyo) での今日の日付 "YYYY-MM-DD"
function todayInTimezone(env) {
  const timeZone = env.TIMEZONE || "Asia/Tokyo";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateString, delta) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function isAuthorized(request, env) {
  const expected = env.APP_SECRET;
  if (!expected) return false;

  const header = request.headers.get("Authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(given, expected);
}

// 文字列の比較にかかる時間から秘密を推測されないよう、長さが違っても同じ処理を通す
async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}
