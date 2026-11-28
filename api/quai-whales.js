// Vercel Serverless Function: "whale moves" for the QUAI Live dashboard.
//
//   GET /api/quai-whales          -> moves of the last 30 days + 7-day sums (edge-cached 5 min). Any error = empty list.
//   GET /api/quai-whales?run=1    -> scan (every 30 min from scripts/fetch-metrics.mjs; Redis lock 20 min).
//
// Who is watched: the 200 biggest QUAI holders (Quaiscan, sorted by balance) plus the exchange wallets below.
// How: every run compares their balances with the previous run; only addresses whose balance moved by more than the
// threshold get their latest transactions read (so a run costs a handful of requests, not 200). Each large native QUAI
// transfer is classified by the other side: to an exchange (possible sale), from an exchange (withdrawal), between
// exchanges, or wallet to wallet. Addresses that exist since the network launch are marked "genesis" (allocations of
// the foundation, team and investors usually sit there).
// Threshold: tied to liquidity: the section shows transfers worth ≥ max($2k, 0.7 × order-book depth ±2%), the feed
// ≥ max($5k, 2 × depth). A transfer is not a sale: the texts on the page say "sent to Gate", never "whale sells".
const R_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function redis(...cmd) {
  if (!R_URL || !R_TOKEN) throw new Error('Redis is not configured');
  const r = await fetch(R_URL, { method: 'POST', headers: { authorization: 'Bearer ' + R_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(8000) });
  const j = await r.json(); if (j.error) throw new Error('redis: ' + j.error); return j.result;
}
const K = { bal: 'whale:bal', moves: 'whale:moves', info: 'whale:info', lock: 'whale:lock', last: 'whale:lastRun' };
const SCAN = 'https://quaiscan.io/api/v2', EXP = 'https://explorer.qu.ai/api';
const lc = s => String(s || '').toLowerCase();

// Exchange wallets (labels from the official explorer, Nov 2026). Others found by label are added automatically.
const EXCH = { '0x007e2f1a4709b812f339f22e18032118fbcc8987': 'Gate', '0x006243e4ee6c2cf6f993036f27f0a88f265ddb4a': 'MEXC', '0x0075b7f9f9b07c9cb9797926399f7298edf5e182': 'Kraken' };
// Not whales: protocol addresses whose moves are shown elsewhere on the dashboard or mean nothing for the price.
const SKIP = { '0x0050af0000000000000000000000000000000000': 'SOAP burn', '0x0053bcdc4f5af4b35079d4d091fcd1d86a958d06': 'SOAP', '0x006c3e2aaae5db1bcd11a1a097ce572312eaddbb': 'Wrapped Quai',
  '0x0009ac4b8c3357b7f3e7e2baeb07736f3f51896a': 'Hashference staking', '0x004b00d6339f5aae012145356c8d5c71afa1db93': 'gas burner' };
const GENESIS_BEFORE = '2025-02-08';   // first seen before this date = address from the network launch
const LABEL_EX = /gate|mexc|kraken|binance|okx|bybit|kucoin|bitget|htx|huobi|coinex|bitmart|lbank|xt\.com|exchange/i;

async function get(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'qoge-site-whales/1.0 (+https://www.qoge.fun/research/quai-live/)' }, signal: AbortSignal.timeout(10000) });
      if (r.ok) return r.json();
      if (r.status < 500) throw new Error(url.replace(/\?.*/, '') + ' -> HTTP ' + r.status);
    } catch (e) { if (i) throw e; }
  }
  throw new Error(url.replace(/\?.*/, '') + ' -> 5xx');
}
const coins = v => { if (v == null) return 0; const s = String(v); if (/e/i.test(s)) return Number(s) / 1e18; const b = BigInt(s.split('.')[0] || '0'); return Number(b / 10n ** 12n) / 1e6; };

// top holders: Quaiscan (4 pages × 50). Returns [{a, bal, tx}] sorted by balance.
async function holders() {
  let out = [], q = '';
  for (let p = 0; p < 4; p++) {
    const j = await get(`${SCAN}/addresses${q}`);
    for (const x of j.items || []) out.push({ a: lc(x.hash), bal: coins(x.coin_balance), tx: Number(x.tx_count) || 0, name: x.name || '' });
    if (!j.next_page_params) break; q = '?' + new URLSearchParams(j.next_page_params);
  }
  if (out.length < 50) throw new Error('quaiscan: only ' + out.length + ' holders');
  return out;
}
// balance + label + first seen from the official explorer (fallback when Quaiscan refuses the server)
async function info(a) {
  const j = await get(`${EXP}/address/${a}?includeTransactions=false`), i = j.info || {};
  return { bal: coins(i.balance_quai), label: i.label || null, first: i.first_seen ? String(i.first_seen).slice(0, 10) : null };
}
// latest native transfers of one address: Quaiscan, backup explorer
async function txs(a) {
  try {
    const j = await get(`${SCAN}/addresses/${a}/transactions`);
    return (j.items || []).map(t => ({ h: t.hash, t: Date.parse(t.timestamp) / 1000, from: lc(t.from?.hash), to: lc(t.to?.hash), q: coins(t.value), ok: t.status === 'ok' }));
  } catch (e) {
    const j = await get(`${EXP}/address/${a}/transactions?limit=100`);
    return (j.items || []).map(t => ({ h: t.hash || t.tx_hash || t.transaction_hash, t: typeof t.timestamp === 'number' ? (t.timestamp > 1e12 ? t.timestamp / 1000 : t.timestamp) : Date.parse(t.timestamp) / 1000,
      from: lc(t.from_addr), to: lc(t.to_addr), q: coins(t.value), ok: t.status == null || t.status === 1 || t.status === '1' || t.status === 'ok' }));
  }
}
// cached per-address facts (label, first seen); explorer calls only for addresses we have not seen before
async function facts(addrs, cache) {
  const need = [...new Set(addrs)].filter(a => a && !cache[a]).slice(0, 25);
  await Promise.all(need.map(async a => { try { const i = await info(a); cache[a] = { label: i.label, first: i.first }; await redis('HSET', K.info, a, JSON.stringify(cache[a])); } catch (e) {} }));
}

async function run(origin) {
  const rep = { holders: null, candidates: 0, added: [] };
  const d = await get(origin + '/api/quai');
  const price = d.market?.price || d.dex?.price; if (!(price > 0)) throw new Error('no QUAI price');
  const depth = ((d.market?.depthUp || 0) + (d.market?.depthDown || d.market?.depthUp || 0)) / 2;
  const secUsd = Math.max(2000, 0.7 * depth), feedUsd = Math.max(5000, 2 * depth), minQ = secUsd / price;

  let top; try { top = await holders(); rep.holders = 'quaiscan ' + top.length; }
  catch (e) {   // Quaiscan down: re-read the last known whales one by one from the explorer
    const prev = JSON.parse(await redis('GET', K.bal) || '{}'), list = Object.keys(prev).slice(0, 80);
    top = []; await Promise.all(list.map(async a => { try { const i = await info(a); top.push({ a, bal: i.bal, tx: 0 }); } catch (x) {} }));
    top.sort((x, y) => y.bal - x.bal); rep.holders = 'explorer ' + top.length + ' (quaiscan: ' + String(e.message).slice(0, 60) + ')';
    if (!top.length) throw e;
  }
  const rank = {}; top.forEach((x, i) => { rank[x.a] = i + 1; });
  for (const a of Object.keys(EXCH)) if (!top.find(x => x.a === a)) { try { top.push({ a, bal: (await info(a)).bal, tx: 0 }); } catch (e) {} }
  const watch = top.filter(x => !SKIP[x.a] && (EXCH[x.a] || x.tx < 200000));   // very busy unlabelled = mining pool payouts

  const prevRaw = await redis('GET', K.bal), prev = JSON.parse(prevRaw || '{}'), now = Date.now() / 1000;
  const since = Number(await redis('GET', K.last) || 0) || now - 3600;
  const bal = {}; watch.forEach(x => { bal[x.a] = x.bal; });
  if (!prevRaw) { await redis('SET', K.bal, JSON.stringify(bal)); await redis('SET', K.last, String(now)); rep.baseline = true; return rep; }
  // candidates: balance moved by ≥ minQ, or a whale that left the top list
  const cand = watch.filter(x => prev[x.a] != null && Math.abs(x.bal - prev[x.a]) >= minQ).map(x => x.a)
    .concat(Object.keys(prev).filter(a => bal[a] == null && prev[a] >= minQ));
  rep.candidates = cand.length;
  const cache = {}; const infoAll = await redis('HGETALL', K.info) || []; for (let i = 0; i < infoAll.length; i += 2) { try { cache[infoAll[i]] = JSON.parse(infoAll[i + 1]); } catch (e) {} }
  const found = {};
  for (const a of cand.slice(0, 25)) {
    let list; try { list = await txs(a); } catch (e) { continue; }
    for (const t of list) if (t.ok && t.h && t.q >= minQ && t.t > since - 3600 && t.from !== t.to) found[t.h] = t;
  }
  const moves = Object.values(found);
  await facts(moves.flatMap(m => [m.from, m.to]), cache);
  const exName = a => EXCH[a] || (cache[a]?.label && LABEL_EX.test(cache[a].label) ? cache[a].label : null);
  for (const m of moves) {
    if (SKIP[m.from] || SKIP[m.to]) continue;
    const fe = exName(m.from), te = exName(m.to);
    const kind = fe && te ? 'exex' : te ? 'toEx' : fe ? 'fromEx' : 'move';
    const rec = { h: m.h, t: Math.round(m.t), from: m.from, to: m.to, q: Math.round(m.q), usd: Math.round(m.q * price), kind,
      fromEx: fe, toEx: te, fromRank: rank[m.from] || null, toRank: rank[m.to] || null,
      fromLabel: !fe && cache[m.from]?.label || null, toLabel: !te && cache[m.to]?.label || null,
      genesis: !!(cache[m.from]?.first && cache[m.from].first < GENESIS_BEFORE), feed: m.q * price >= feedUsd };
    if (await redis('HSETNX', K.moves, m.h, JSON.stringify(rec))) { rep.added.push(m.h); if (rec.usd >= Math.max(20000, 4 * feedUsd)) await notify(rec); }
  }
  // keep 30 days
  const all = await redis('HGETALL', K.moves) || [], old = [];
  for (let i = 0; i < all.length; i += 2) { try { if (JSON.parse(all[i + 1]).t < now - 30 * 86400) old.push(all[i]); } catch (e) { old.push(all[i]); } }
  if (old.length) await redis('HDEL', K.moves, ...old);
  await redis('SET', K.bal, JSON.stringify(bal)); await redis('SET', K.last, String(now));
  return rep;
}

const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '?';
async function notify(m) {
  const token = process.env.TELEGRAM_BOT_TOKEN, owner = process.env.TELEGRAM_OWNER_ID; if (!token || !owner) return;
  const what = m.kind === 'toEx' ? `ушло на ${m.toEx}` : m.kind === 'fromEx' ? `выведено с ${m.fromEx}` : m.kind === 'exex' ? `переведено ${m.fromEx} → ${m.toEx}` : 'переложил кит';
  const text = `🐋 Крупный перевод QUAI: ${m.q.toLocaleString('ru-RU')} QUAI (~$${m.usd.toLocaleString('ru-RU')}) ${what}\n${short(m.from)} → ${short(m.to)}${m.genesis ? ' · адрес с запуска сети' : ''}\nhttps://quaiscan.io/tx/${m.h}\n\nhttps://www.qoge.fun/research/quai-live/#whales`;
  try { await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000), body: JSON.stringify({ chat_id: owner, text, link_preview_options: { is_disabled: true } }) }); } catch (e) {}
}

async function state() {
  const all = await redis('HGETALL', K.moves) || [], moves = [];
  for (let i = 1; i < all.length; i += 2) { try { moves.push(JSON.parse(all[i])); } catch (e) {} }
  moves.sort((a, b) => b.t - a.t);
  const wk = Date.now() / 1000 - 7 * 86400, w = moves.filter(m => m.t >= wk);
  const sum = k => w.filter(m => m.kind === k).reduce((s, m) => ({ q: s.q + m.q, usd: s.usd + m.usd, n: s.n + 1 }), { q: 0, usd: 0, n: 0 });
  const last = Number(await redis('GET', K.last) || 0);
  return { updatedAt: last ? new Date(last * 1000).toISOString() : null, started: !!last, week: { toEx: sum('toEx'), fromEx: sum('fromEx'), move: sum('move') }, moves: moves.slice(0, 200) };
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'https://' + (req.headers.host || 'www.qoge.fun'));
  try {
    if (url.searchParams.get('run') === '1') {
      const lock = await redis('SET', K.lock, '1', 'NX', 'EX', '1200');
      const origin = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'www.qoge.fun');
      let rep; try { rep = lock ? await run(origin) : { skipped: 'ran less than 20 min ago' }; } catch (e) { rep = { error: String(e.message || e).slice(0, 200) }; }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(rep);
    }
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).json(await state());
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ moves: [], week: null, started: false, error: String(e.message || e).slice(0, 200) });
  }
};
module.exports.run = run; module.exports.state = state; module.exports.EXCH = EXCH;
