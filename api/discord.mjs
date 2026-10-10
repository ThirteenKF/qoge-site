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
  if (i.type !== 2 || !i.member) return reply('Use this command in the QOGE server.');

  // every reply in both languages; the member's own language goes first
  const t = bilingual(String(i.locale || '').startsWith('ru') ? [T.ru, T.en] : [T.en, T.ru]);
  try {
    if (i.data.name === 'whitelist') return await whitelist(i, t);
    if (i.data.name === 'whitelist-me') return await me(i, t);
    if (i.data.name === 'wl-admin') return await admin(i);
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
    description: 'Join the Mars Gum mint whitelist (QOGE Holders)',
    description_localizations: { ru: 'Записаться в whitelist минта Mars Gum (для QOGE Holder)' },
    options: [{
      type: 3, name: 'address', required: true, min_length: 42, max_length: 42,
      description: 'Your Pelagus wallet address (0x00…)',
      description_localizations: { ru: 'Адрес твоего Pelagus-кошелька (0x00…)' },
    }],
  },
  {
    name: 'whitelist-me', type: 1, contexts: [0],
    description: 'Show your whitelisted wallet',
    description_localizations: { ru: 'Показать мой кошелёк в whitelist' },
  },
  {
    name: 'wl-admin', type: 1, contexts: [0], default_member_permissions: MANAGE_GUILD,
    description: 'Whitelist admin: status / close / open next wave',
    options: [{
      type: 3, name: 'action', required: true, description: 'What to do',
      choices: [{ name: 'status', value: 'status' }, { name: 'export CSV', value: 'export' }, { name: 'close registration', value: 'close' }, { name: 'open next wave', value: 'open-next' }],
    }],
  },
];

async function discord(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'content-type': 'application/json' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
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
