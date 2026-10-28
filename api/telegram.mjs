// QOGE Telegram bot: posts the weekly "QNN Weekly" digest to the QOGE Telegram channel.
//
// Flow (safe by default): Claude prepares the digest every Sunday -> POST /api/telegram?action=draft
// -> the bot sends the draft to the owner in a private chat with buttons
//    [✅ Опубликовать] [🗑 Отклонить]  -> one tap posts it to the channel.
// To fix a draft: send the bot the corrected full text as a normal message -> new draft with buttons.
// Set TELEGRAM_AUTOPUBLISH=1 to skip the approval step and post straight to the channel.
//
// Vercel env vars (Project -> Settings -> Environment Variables):
//   TELEGRAM_BOT_TOKEN       token from @BotFather (secret, never commit it)
//   TELEGRAM_CHANNEL         channel id, e.g. -1004432723119 (or @ChannelUsername)
//   TELEGRAM_OWNER_ID        your Telegram user id (the bot tells it to you on /start)
//   TELEGRAM_WEBHOOK_SECRET  any random string (protects the webhook)
//   DIGEST_SECRET            random string shared with the weekly Claude task (allows sending drafts)
//   TELEGRAM_AUTOPUBLISH     optional, "1" = publish without approval
//   KV_REST_API_URL + KV_REST_API_TOKEN (already set for the Discord bot)
//
// After the env vars are set and the site is deployed, open once:
//   https://www.qoge.fun/api/telegram?action=setup
// (registers the webhook). Then write /start to the bot.

export const config = { runtime: 'nodejs' };

const env = process.env;
const CHANNEL = env.TELEGRAM_CHANNEL || '-1004432723119';
const OWNER = String(env.TELEGRAM_OWNER_ID || '');

// ---------- Upstash Redis (same store as the Discord bot) ----------
const R_URL = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
async function redis(...cmd) {
  const res = await fetch(R_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + R_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await res.json();
  if (j.error) throw new Error('redis: ' + j.error);
  return j.result;
}
const DRAFT = (id) => 'tg:draft:' + id;
const WEEK = 7 * 24 * 3600;

// ---------- Telegram Bot API ----------
async function tg(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`${method}: ${j.description || res.status}`);
  return j.result;
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const timingSafeEq = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

async function publish(text) {
  return tg('sendMessage', { chat_id: CHANNEL, text, link_preview_options: { is_disabled: false } });
}

// store a draft and show it to the owner with buttons
async function newDraft(text, source) {
  const id = Date.now().toString(36);
  await redis('SET', DRAFT(id), text, 'EX', WEEK);
  if (!OWNER) throw new Error('TELEGRAM_OWNER_ID is not set');
  await tg('sendMessage', {
    chat_id: OWNER,
    text,
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [[
      { text: '✅ Опубликовать в канал', callback_data: 'pub:' + id },
      { text: '🗑 Отклонить', callback_data: 'del:' + id },
    ]] },
  });
  await tg('sendMessage', {
    chat_id: OWNER,
    text: `⬆️ Черновик (${source}), ${text.length} символов. Нажми «Опубликовать» или пришли исправленный текст целиком — сделаю новый черновик.`,
  });
  return id;
}

// ---------- 1) draft from the weekly Claude task ----------
async function draftEndpoint(request) {
  const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.DIGEST_SECRET || !timingSafeEq(auth, env.DIGEST_SECRET)) return json({ ok: false, error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }
  const text = String(body.text || '').trim();
  if (text.length < 50) return json({ ok: false, error: 'text too short' }, 400);
  if (text.length > 4096) return json({ ok: false, error: `text too long: ${text.length} > 4096` }, 400);
  if (env.TELEGRAM_AUTOPUBLISH === '1') {
    const m = await publish(text);
    if (OWNER) await tg('sendMessage', { chat_id: OWNER, text: `✅ Дайджест опубликован в канале (сообщение ${m.message_id}).` });
    return json({ ok: true, published: true, message_id: m.message_id });
  }
  const id = await newDraft(text, body.title || 'QNN Weekly');
  return json({ ok: true, published: false, draft: id });
}

// ---------- 2) Telegram webhook ----------
async function webhook(request) {
  const secret = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!env.TELEGRAM_WEBHOOK_SECRET || !timingSafeEq(secret, env.TELEGRAM_WEBHOOK_SECRET)) return new Response('forbidden', { status: 403 });
  const u = await request.json();

  // button taps on a draft
  if (u.callback_query) {
    const q = u.callback_query;
    const from = String(q.from?.id || '');
    if (from !== OWNER) { await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Нет доступа' }); return new Response('ok'); }
    const [act, id] = String(q.data || '').split(':');
    const text = await redis('GET', DRAFT(id));
    if (!text) { await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Черновик устарел или уже обработан' }); return new Response('ok'); }
    await redis('DEL', DRAFT(id)); // one tap = one post, no double posting
    if (act === 'pub') {
      const m = await publish(text);
      await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Опубликовано ✅' });
      await tg('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: `✅ Опубликовано (№${m.message_id})`, callback_data: 'done' }]] } });
    } else {
      await tg('answerCallbackQuery', { callback_query_id: q.id, text: 'Черновик отклонён' });
      await tg('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: '🗑 Отклонён', callback_data: 'done' }]] } });
    }
    return new Response('ok');
  }

  // private messages
  const msg = u.message;
  if (msg && msg.chat?.type === 'private') {
    const from = String(msg.from?.id || '');
    const text = String(msg.text || '');
    if (text.startsWith('/start') || text.startsWith('/id')) {
      const own = from === OWNER;
      await tg('sendMessage', {
        chat_id: msg.chat.id,
        text: own
          ? '🐕 QOGE News bot на связи. Каждое воскресенье сюда придёт черновик QNN Weekly с кнопкой «Опубликовать».'
          : `🐕 Привет! Твой Telegram ID: ${from}\nВладелец канала: впиши его в Vercel как TELEGRAM_OWNER_ID и сделай Redeploy.`,
      });
    } else if (from === OWNER && text.length >= 200) {
      await newDraft(text, 'исправленный');
    } else if (from === OWNER) {
      await tg('sendMessage', { chat_id: msg.chat.id, text: 'Чтобы исправить черновик, пришли его текст целиком (от 200 символов).' });
    }
  }
  return new Response('ok');
}

export async function POST(request) {
  const action = new URL(request.url).searchParams.get('action');
  try {
    if (action === 'draft') return await draftEndpoint(request);
    return await webhook(request);
  } catch (e) {
    console.error(e);
    return action === 'draft' ? json({ ok: false, error: e.message }, 500) : new Response('ok'); // never make Telegram retry forever
  }
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  if (q.get('action') !== 'setup') return new Response('QOGE Telegram bot is alive 🐶');
  try {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return json({ ok: false, error: 'set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in Vercel first' }, 400);
    const origin = new URL(request.url).origin;
    const me = await tg('getMe', {});
    await tg('setWebhook', { url: origin + '/api/telegram', secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    let channel = null;
    try { const c = await tg('getChat', { chat_id: CHANNEL }); channel = c.title; } catch (e) { channel = 'НЕ ВИЖУ КАНАЛ: добавь бота админом канала (' + e.message + ')'; }
    return json({ ok: true, bot: '@' + me.username, webhook: origin + '/api/telegram', channel, owner_set: !!OWNER, digest_secret_set: !!env.DIGEST_SECRET, autopublish: env.TELEGRAM_AUTOPUBLISH === '1' });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
