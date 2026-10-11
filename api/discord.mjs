// Vercel Function (.mjs = ES module): QOGE Discord bot (slash commands for the Mars Gum mint whitelist).
//
// POST /api/discord  <- Discord "Interactions Endpoint URL" (signed requests from Discord)
//   /whitelist address:<0x00…>  register / replace your wallet (QOGE Holder role required)
//   /whitelist-me                show your registered wallet
//   /wl-admin action:<status|export|close|open-next>   (only members with Manage Server;
//                                                       export = CSV file, visible only to the admin)
// GET  /api/discord?action=setup   registers the commands + finds the QOGE Holder role
//                                  (harmless to re-run; throttled to once a minute)
//
// Rules: one Discord account = one wallet, one wallet = one Discord account. Replacing your
// wallet frees the old one. Data lives in Upstash Redis (free tier, via the Vercel Marketplace).
//
// Env vars (Vercel -> Settings -> Environment Variables):
//   DISCORD_APP_ID, DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN
//   KV_REST_API_URL + KV_REST_API_TOKEN  (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
//   optional: DISCORD_GUILD_ID (default = QOGE server), HOLDER_ROLE_NAME (default "QOGE Holder")
import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

const env = process.env;
const GUILD_ID = env.DISCORD_GUILD_ID || '1556263844505067600';
const ROLE_NAME = env.HOLDER_ROLE_NAME || 'QOGE Holder';
const API = 'https://discord.com/api/v10';
const K = { users: 'wl:users', addrs: 'wl:addrs', role: 'wl:role', wave: 'wl:wave', open: 'wl:open', setup: 'wl:setup' };
const EPHEMERAL = 64;
const MANAGE_GUILD = String(1 << 5);

// Quai Cyprus-1 address on the Quai ledger: 0x00 zone byte, high bit of the 2nd byte = 0.
const QUAI_ADDR = /^0x00[0-7][0-9a-f]{37}$/;

// ---------- Upstash Redis (REST) ----------
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

// ---------- texts (Russian for ru clients, English for everyone else) ----------
const T = {
  ru: {
    noRole: '🔒 Сначала получи роль **QOGE Holder**: купи $QOGE и подтверди кошелёк в <#1557426345305186334>.',
    bad: '❌ Это не похоже на Quai-адрес. Нужен адрес Pelagus-кошелька: `0x00…`, 42 символа.',
    closed: '⏸ Запись сейчас закрыта. Следи за <#1557418787693924415> — скоро следующая волна.',
    same: (w) => `✅ Этот кошелёк уже в whitelist (Волна ${w}).`,
    taken: '⚠️ Этот адрес уже записан другим участником. Один кошелёк — один аккаунт.',
    added: (w) => `✅ Готово! Ты в whitelist Mars Gum, Волна ${w}. Держи $QOGE на этом кошельке до минта.`,
    replaced: () => '🔁 Кошелёк заменён (старый адрес удалён из списка).',
    me: (w) => `🎟 Твой кошелёк в whitelist (Волна ${w}):`,
    meNone: 'Тебя пока нет в whitelist. Запишись: `/whitelist address: 0x00…`',
    oops: '⚠️ Что-то пошло не так, попробуй через минуту.',
  },
  en: {
    noRole: '🔒 Get the **QOGE Holder** role first: buy $QOGE and verify your wallet in <#1557426345305186334>.',
    bad: "❌ That doesn't look like a Quai address. Use your Pelagus wallet address: `0x00…`, 42 characters.",
    closed: '⏸ Registration is closed right now. Watch <#1557418787693924415> — the next wave is coming.',
    same: (w) => `✅ This wallet is already on the whitelist (Wave ${w}).`,
    taken: '⚠️ This address is already registered by another member. One wallet = one account.',
    added: (w) => `✅ Done! You're on the Mars Gum whitelist, Wave ${w}. Keep $QOGE on this wallet until mint.`,
    replaced: () => '🔁 Wallet replaced (the old address was removed).',
    me: (w) => `🎟 Your whitelisted wallet (Wave ${w}):`,
    meNone: "You're not on the whitelist yet. Register: `/whitelist address: 0x00…`",
    oops: '⚠️ Something went wrong, try again in a minute.',
  },
};

const SEP = '\n\n';
const addr = (a) => `\n\n🎟 \`${a}\``;
function bilingual([first, second]) {
  const out = {};
  for (const k of Object.keys(first)) {
    const x = first[k], y = second[k];
    out[k] = typeof x === 'function' ? (...args) => x(...args) + SEP + y(...args) : x + SEP + y;
  }
  return out;
}

const reply = (content) => Response.json({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

// stored value: address|wave|unixTime|username
const pack = (a, w, name) => [a, w, Math.floor(Date.now() / 1000), String(name).replace(/[|\n]/g, '')].join('|');
const unpack = (v) => { if (!v) return null; const [addr, wave, t, name] = v.split('|'); return { addr, wave, t, name }; };

async function whitelist(i, t) {
  const uid = i.member.user.id, name = i.member.user.username;
  const roleId = await redis('GET', K.role);
  if (!roleId || !i.member.roles.includes(roleId)) return reply(t.noRole);

  const raw = String(i.data.options?.[0]?.value || '').trim().toLowerCase();
  if (!QUAI_ADDR.test(raw)) return reply(t.bad);

  if ((await redis('GET', K.open)) === '0') return reply(t.closed);
  const wave = (await redis('GET', K.wave)) || '1';

  const mine = unpack(await redis('HGET', K.users, uid));
  if (mine && mine.addr === raw) return reply(t.same(mine.wave) + addr(raw));

  // claim the address atomically; if someone else owns it, refuse
  const claimed = await redis('HSETNX', K.addrs, raw, uid);
  if (!claimed && (await redis('HGET', K.addrs, raw)) !== uid) return reply(t.taken);

  if (mine) {
    await redis('HDEL', K.addrs, mine.addr);
    await redis('HSET', K.users, uid, pack(raw, mine.wave, name));
    return reply(t.replaced() + `\n\n❌ ~~${mine.addr}~~\n✅ \`${raw}\``);
  }
  await redis('HSET', K.users, uid, pack(raw, wave, name));
  return reply(t.added(wave) + addr(raw));
}

async function me(i, t) {
  const mine = unpack(await redis('HGET', K.users, i.member.user.id));
  return reply(mine ? t.me(mine.wave) + addr(mine.addr) : t.meNone);
}

async function admin(i) {
  const action = i.data.options?.[0]?.value || 'status';
  if (action === 'export') return csvReply();
  if (action === 'close') await redis('SET', K.open, '0');
  if (action === 'open-next') { await redis('INCR', K.wave); await redis('SET', K.open, '1'); }
  const [count, wave, open] = await Promise.all([redis('HLEN', K.users), redis('GET', K.wave), redis('GET', K.open)]);
  return reply(`📋 Whitelist: **${count}** wallets · wave **${wave || 1}** · registration **${open === '0' ? 'closed' : 'open'}**\n` +
    'CSV: `/wl-admin action: export`');
}

// ---------- giveaways ----------
// /giveaway start prize winners -> public post with a Join button (custom_id gw:<id>)
// button -> only QOGE Holder can enter (set gw:<id>:users)
// /giveaway draw -> random winners among entrants who STILL have the role
const GW = { cur: 'gw:current', prize: id => `gw:${id}:prize`, n: id => `gw:${id}:winners`, users: id => `gw:${id}:users`, ended: id => `gw:${id}:ended`, msg: id => `gw:${id}:msg` };

// the giveaway card; when ended, both buttons are greyed out and the winners are listed
function card(id, prize, n, winners) {
  const ended = Array.isArray(winners);
  const body = ended
    ? `**Приз / Prize:** ${prize}\n\n🏆 **Победители / Winners:** ${winners.length ? winners.map(u => `<@${u}>`).join(' ') : '—'}\n\n⏹ Розыгрыш завершён / Giveaway ended`
    : `**Приз / Prize:** ${prize}\n**Победителей / Winners:** ${n}\n\n🎉 Нажми кнопку, чтобы участвовать!\n🎉 Press the button to join!\n\n🔒 Только для / Only for **QOGE Holder**`;
  return {
    embeds: [{ color: ended ? 0x5b5b66 : YELLOW, title: ended ? '🎁 QOGE Giveaway — завершён / ended' : '🎁 QOGE Giveaway', description: body }],
    components: [{ type: 1, components: [
      { type: 2, style: ended ? 2 : 1, label: ended ? 'Завершён / Ended' : 'Участвовать / Join', emoji: { name: '🎉' }, custom_id: 'gw:' + id, disabled: ended },
    ] }],
  };
}
const YELLOW = 0xf5d33a;
const pub = (data) => Response.json({ type: 4, data: { allowed_mentions: { parse: [] }, ...data } });

async function giveaway(i) {
  const sub = i.data.options?.[0] || {};
  const opt = Object.fromEntries((sub.options || []).map(o => [o.name, o.value]));
  const id = await redis('GET', GW.cur);

  if (sub.name === 'start') {
    const nid = String(Date.now());
    const prize = String(opt.prize || '').slice(0, 200), winners = Math.max(1, Math.min(20, Number(opt.winners) || 1));
    await redis('SET', GW.prize(nid), prize);
    await redis('SET', GW.n(nid), String(winners));
    await redis('SET', GW.cur, nid);
    return pub(card(nid, prize, winners));
  }

  if (!id) return reply('Нет активного розыгрыша / No active giveaway. `/giveaway start`');
  const [prize, n, count, ended] = await Promise.all([redis('GET', GW.prize(id)), redis('GET', GW.n(id)), redis('SCARD', GW.users(id)), redis('GET', GW.ended(id))]);

  if (sub.name === 'status') return reply(`🎁 **${prize}** · участников / entrants: **${count}** · winners: ${n} · ${ended ? 'завершён / ended' : 'идёт / running'}`);

  if (sub.name === 'draw') return await drawGiveaway(id, i.channel_id, i.member.user.id);
  return reply('Unknown');
}

async function drawGiveaway(id, fallbackChannel, adminId) {
  const [prize, n, count, ended] = await Promise.all([redis('GET', GW.prize(id)), redis('GET', GW.n(id)), redis('SCARD', GW.users(id)), redis('GET', GW.ended(id))]);
  if (!prize) return reply('Розыгрыш не найден / Giveaway not found');
    if (ended) return reply('Этот розыгрыш уже завершён / Already drawn. Новый: `/giveaway start`');
    const pool = (await redis('SMEMBERS', GW.users(id))) || [];
    for (let k = pool.length - 1; k > 0; k--) { const j = crypto.randomInt(k + 1); [pool[k], pool[j]] = [pool[j], pool[k]]; }
    const roleId = await redis('GET', K.role), winners = [];
    for (const uid of pool) {
      if (winners.length >= Number(n)) break;
      if (await stillHolder(uid, roleId)) winners.push(uid);
    }
    await redis('SET', GW.ended(id), '1');
    await closeCard(id, prize, n, winners);
    const where = (await redis('GET', GW.msg(id))) || '';
    const ch = where.split('/')[0] || fallbackChannel;
    const tickets = await Promise.all(winners.map(u => openTicket(ch, u, prize, adminId)));
    if (!winners.length) return pub({ content: `🎁 **${prize}** — нет участников с ролью QOGE Holder / no eligible entrants.` });
    const list = winners.map(u => `<@${u}>`).join(' ');
    return pub({
      content: `🎉 ${list}`,
      allowed_mentions: { users: winners },
      embeds: [{ color: YELLOW, title: '🏆 QOGE Giveaway — победители / winners',
        description: `**Приз / Prize:** ${prize}\n\n${list}\n\nУчастников / Entrants: ${count}\n\n` +
          (tickets.some(Boolean)
            ? `🎟 Победитель, напиши в свой тикет / Winner, write in your ticket:\n${tickets.map((t, k) => t ? `<@${winners[k]}> → <#${t}>` : `<@${winners[k]}> → напиши команде / DM the team`).join('\n')}`
            : 'Поздравляем! Напиши команде, чтобы забрать приз. / Congrats! DM the team to claim.') }],
    });
  }

// private ticket thread for a winner: only the winner + admins see it. Returns the thread id or null.
async function openTicket(channelId, uid, prize, adminId) {
  try {
    let name = uid;
    try { const m = await discord(`/guilds/${GUILD_ID}/members/${uid}`); name = m.nick || m.user.global_name || m.user.username; } catch {}
    const th = await discord(`/channels/${channelId}/threads`, { method: 'POST', body: JSON.stringify({
      name: `🎟 ${name} — ${prize}`.slice(0, 100), type: 12, invitable: false, auto_archive_duration: 10080 }) });
    await discord(`/channels/${th.id}/thread-members/${uid}`, { method: 'PUT' });
    // the admin who drew joins too, so the ticket shows up in their channel list and they get notified
    if (adminId && adminId !== uid) { try { await discord(`/channels/${th.id}/thread-members/${adminId}`, { method: 'PUT' }); } catch {} }
    await discord(`/channels/${th.id}/messages`, { method: 'POST', body: JSON.stringify({
      content: `🎉 <@${uid}>, поздравляем! Ты выиграл: **${prize}**\n` +
        'Напиши сюда!\n' +
        '🔒 Этот тикет видишь только ты и админы. Никогда не присылай seed-фразу или приватный ключ!\n\n' +
        `🎉 <@${uid}>, congrats! You won: **${prize}**\n` +
        'Write here!\n' +
        '🔒 Only you and the admins can see this ticket. Never share your seed phrase or private key!',
      allowed_mentions: { users: [uid] } }) });
    return th.id;
  } catch (e) { console.error('openTicket', e.message); return null; }
}

const CMD_DRAW = 'Выбрать победителя', CMD_CLOSE = 'Закрыть тикет';

async function drawFromCard(i) {
  const msg = i.data.resolved?.messages?.[i.data.target_id];
  const btn = (msg?.components || []).flatMap(r => r.components || []).find(c => String(c.custom_id || '').startsWith('gw:'));
  if (!btn) return reply('Нажми правой кнопкой на карточку розыгрыша 🎁 QOGE Giveaway.\n\nRight-click the 🎁 QOGE Giveaway card.');
  const id = btn.custom_id.slice(3);
  await redis('SET', GW.msg(id), `${i.channel_id}/${msg.id}`);
  return await drawGiveaway(id, i.channel_id, i.member.user.id);
}

async function closeTicket(i) {
  const type = i.channel?.type;
  if (type !== 11 && type !== 12) return reply('Это работает только внутри тикета 🎟.\n\nUse this inside a 🎟 ticket.');
  await discord(`/channels/${i.channel_id}`, { method: 'PATCH', body: JSON.stringify({ archived: true, locked: true }) });
  return reply('🔒 Тикет закрыт / Ticket closed.');
}

// grey out the card's buttons (needs the bot to see the channel); never blocks the announcement
async function closeCard(id, prize, n, winners) {
  try {
    const where = await redis('GET', GW.msg(id));
    if (!where) return;
    const [ch, msg] = where.split('/');
    await discord(`/channels/${ch}/messages/${msg}`, { method: 'PATCH', body: JSON.stringify(card(id, prize, n, winners)) });
  } catch (e) { console.error('closeCard', e.message); }
}

// re-check the role at draw time (someone could have sold and lost it); if Discord can't be asked, keep them
async function stillHolder(uid, roleId) {
  try { const m = await discord(`/guilds/${GUILD_ID}/members/${uid}`); return m.roles.includes(roleId); }
  catch (e) { return !String(e.message).includes('HTTP 404'); }
}

async function giveawayJoin(i) {
  const id = i.data.custom_id.slice(3), uid = i.member.user.id;
  if (i.message?.id) await redis('SET', GW.msg(id), `${i.channel_id}/${i.message.id}`);
  const roleId = await redis('GET', K.role);
  if (await redis('GET', GW.ended(id))) return reply('⏹ Розыгрыш уже завершён.\n\n⏹ This giveaway has ended.');
  if (!roleId || !i.member.roles.includes(roleId)) return reply(T.ru.noRole + '\n\n' + T.en.noRole);
  const added = await redis('SADD', GW.users(id), uid);
  const count = await redis('SCARD', GW.users(id));
  return reply(added
    ? `✅ Ты участвуешь! Всего участников: **${count}**. Удачи 🍀\n\n✅ You're in! Entrants: **${count}**. Good luck 🍀`
    : `👌 Ты уже участвуешь. Участников: **${count}**.\n\n👌 You're already in. Entrants: **${count}**.`);
}

// ---------- Discord signature check (Ed25519) ----------
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
function verify(body, sig, ts) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(env.DISCORD_PUBLIC_KEY, 'hex')]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(ts + body), key, Buffer.from(sig, 'hex'));
  } catch { return false; }
}

export async function POST(request) {
  const body = await request.text();
  const sig = request.headers.get('x-signature-ed25519'), ts = request.headers.get('x-signature-timestamp');
  if (!sig || !ts || !verify(body, sig, ts)) return new Response('invalid request signature', { status: 401 });

  const i = JSON.parse(body);
  if (i.type === 1) return Response.json({ type: 1 }); // PING
  if (!i.member) return reply('Use this in the QOGE server.');
  if (i.type === 3 && String(i.data?.custom_id || '').startsWith('gwdraw:')) {
    try {
      const perms = BigInt(i.member.permissions || '0');
      if (!(perms & 0x20n) && !(perms & 0x8n)) return reply('🔒 Только для админов.\n\n🔒 Admins only.');
      const gid = i.data.custom_id.slice(7);
      if (i.message?.id) await redis('SET', GW.msg(gid), `${i.channel_id}/${i.message.id}`);
      return await drawGiveaway(gid, i.channel_id, i.member.user.id);
    } catch (e) { console.error(e); return reply('⚠️ Ошибка, попробуй ещё раз / Error, try again'); }
  }
  if (i.type === 3 && String(i.data?.custom_id || '').startsWith('gw:')) {
    try { return await giveawayJoin(i); } catch (e) { console.error(e); return reply('⚠️ Ошибка, попробуй ещё раз / Error, try again'); }
  }
  if (i.type !== 2) return reply('Unknown interaction');

  // right-click (message) commands, visible to admins only
  if (i.data.type === 3) {
    try {
      if (i.data.name === CMD_DRAW) return await drawFromCard(i);
      if (i.data.name === CMD_CLOSE) return await closeTicket(i);
    } catch (e) { console.error(e); return reply('⚠️ Ошибка, попробуй ещё раз / Error, try again'); }
  }

  // every reply in both languages; the member's own language goes first
  const t = bilingual(String(i.locale || '').startsWith('ru') ? [T.ru, T.en] : [T.en, T.ru]);
  try {
    if (i.data.name === 'whitelist') return await whitelist(i, t);
    if (i.data.name === 'whitelist-me') return await me(i, t);
    if (i.data.name === 'wl-admin') return await admin(i);
    if (i.data.name === 'giveaway') return await giveaway(i);
    return reply('Unknown command');
  } catch (e) {
    console.error(e);
    return reply(t.oops);
  }
}

// ---------- admin endpoints ----------
const COMMANDS = [
  {
    name: 'whitelist', type: 1, contexts: [0],
    description: 'Записаться в whitelist Mars Gum / Join the Mars Gum whitelist (QOGE Holder)',
    options: [{
      type: 3, name: 'address', required: true, min_length: 42, max_length: 42,
      description: 'Адрес Pelagus-кошелька / Your Pelagus wallet address (0x00…)',
    }],
  },
  {
    name: 'whitelist-me', type: 1, contexts: [0],
    description: 'Мой кошелёк в whitelist / Show my whitelisted wallet',
  },
  {
    name: 'wl-admin', type: 1, contexts: [0], default_member_permissions: MANAGE_GUILD,
    description: 'Whitelist admin: status / close / open next wave',
    options: [{
      type: 3, name: 'action', required: true, description: 'What to do',
      choices: [{ name: 'status', value: 'status' }, { name: 'export CSV', value: 'export' }, { name: 'close registration', value: 'close' }, { name: 'open next wave', value: 'open-next' }],
    }],
  },
  {
    name: 'giveaway', type: 1, contexts: [0], default_member_permissions: MANAGE_GUILD,
    description: 'Розыгрыш для QOGE Holder / Giveaway for QOGE Holders',
    options: [
      { type: 1, name: 'start', description: 'Начать розыгрыш с кнопкой / Start a giveaway with a Join button', options: [
        { type: 3, name: 'prize', required: true, max_length: 200, description: 'Что разыгрываем / Prize' },
        { type: 4, name: 'winners', required: false, min_value: 1, max_value: 20, description: 'Сколько победителей (1 по умолчанию) / Number of winners' },
      ] },
      { type: 1, name: 'draw', description: 'Выбрать победителей / Pick the winners' },
      { type: 1, name: 'status', description: 'Сколько участников / Entrants count' },
    ],
  },
  { name: CMD_DRAW, type: 3, contexts: [0], default_member_permissions: MANAGE_GUILD },
  { name: CMD_CLOSE, type: 3, contexts: [0], default_member_permissions: MANAGE_GUILD },
];

async function discord(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'content-type': 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function setup() {
  const cmds = await discord(`/applications/${env.DISCORD_APP_ID}/guilds/${GUILD_ID}/commands`, { method: 'PUT', body: JSON.stringify(COMMANDS) });
  const roles = await discord(`/guilds/${GUILD_ID}/roles`);
  const role = roles.find(r => r.name === ROLE_NAME);
  if (!role) throw new Error(`role "${ROLE_NAME}" not found`);
  await redis('SET', K.role, role.id);
  if (!(await redis('GET', K.wave))) await redis('SET', K.wave, '1');
  return { ok: true, commands: cmds.map(c => '/' + c.name), holderRole: `${role.name} (${role.id})`, wave: await redis('GET', K.wave) };
}

async function csvText() {
  const all = (await redis('HGETALL', K.users)) || []; // [uid, value, uid, value, ...]
  const rows = ['discord_id,username,address,wave,registered_utc'];
  for (let n = 0; n < all.length; n += 2) {
    const v = unpack(all[n + 1]);
    rows.push([all[n], v.name, v.addr, v.wave, new Date(v.t * 1000).toISOString()].join(','));
  }
  return { text: rows.join('\n') + '\n', count: rows.length - 1 };
}

// ephemeral reply with the CSV attached (multipart: payload_json + files[0])
async function csvReply() {
  const { text, count } = await csvText();
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ type: 4, data: {
    content: `📎 Whitelist: **${count}** wallets`, flags: EPHEMERAL,
    attachments: [{ id: 0, filename: 'mars-gum-whitelist.csv' }],
  } }));
  form.append('files[0]', new Blob([text], { type: 'text/csv' }), 'mars-gum-whitelist.csv');
  return new Response(form);
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  if (q.get('action') !== 'setup') return new Response('QOGE bot is alive 🐶');
  try {
    const last = Number(await redis('GET', K.setup)) || 0;
    if (Date.now() - last < 60000) return Response.json({ ok: false, error: 'wait a minute' }, { status: 429 });
    await redis('SET', K.setup, String(Date.now()));
    return Response.json(await setup());
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
