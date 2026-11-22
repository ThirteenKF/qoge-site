// Vercel Serverless Function: QUAI live dashboard data (research/quai-live/).
// GET /api/quai -> one JSON with market, supply, SOAP reconciliation, network
// and ecosystem numbers. Most sources have no CORS, so the browser can't call
// them directly. Cached at Vercel's edge for 1 h (stale up to 1 day).
// Every source is independent: if one fails, its section is { error } and the
// page falls back to the snapshot in assets/quai-dash.js for that section.
//
// SOURCES is plain JS with no Node APIs, so the same functions can be run in a
// browser on each source's own origin to rebuild the snapshot.

const A = {
  burn: '0x0050af0000000000000000000000000000000000',     // SOAP burn address
  soap: '0x0053bcdc4f5af4b35079d4d091fcd1d86a958d06',     // SOAP wallet (sends to burn)
  gas: '0x004b00d6339f5aae012145356c8d5c71afa1db93',      // "gas burner" wallet (calls a gas-burning contract)
  staking: '0x0009ac4b8c3357b7f3e7e2baeb07736f3f51896a',  // HashferenceStaking contract
};
const SCAN = 'https://quaiscan.io/api/v2';
const EXP = 'https://explorer.qu.ai/api'; // official explorer, used when Quaiscan refuses the server (HTTP 403)
const CG = 'https://api.coingecko.com/api/v3';
const RPC = 'https://rpc.quai.network/cyprus1';
const LLAMA = 'https://api.llama.fi';
// Quainance AMM pair QUAI/USDT (token0 = USDT, 6 decimals; token1 = WQUAI, 18 decimals). Fee 0.3%.
const DEX_PAIR = '0x0021f5cc862ebb0252ba209266f2fabbc7592e83';
const DEX_FEE = 0.003;

// Genesis unlock schedule after the Singularity and Polaris forks, taken from the team's supply tracker
// (supply.qu.ai, GENESIS_UNLOCK_SCHEDULE = post-Singularity schedule minus FOUNDER_UNLOCKS from month 22).
// [schedule month, QUAI]; month m unlocks at block m * 518400. Sum of months 22..48 = 90.39M QUAI.
const BLOCKS_PER_MONTH = 518400;
const UNLOCK_DATES = { 13: '2026-03-04', 14: '2026-04-03', 15: '2026-05-03', 16: '2026-06-02', 17: '2026-07-02', 18: '2026-08-01', 19: '2026-08-31', 20: '2026-09-30' };
const UNLOCKS = [[13,51892587],[14,13642587],[15,13141025],[16,13680731],[17,12976319],[18,13123261],[19,12596288],[20,13103525],[21,12578525],
  [22,3735412],[23,3730412],[24,3723120],[25,3660620],[26,3677287],[27,3643954],[28,3643954],[29,3643954],[30,3643954],[31,3643954],
  [32,3649825],[33,3613083],[34,3241870],[35,3241870],[36,3241870],[37,3241870],[38,3241870],[39,3241870],[40,2991870],[41,2991870],
  [42,2991870],[43,2991870],[44,2991870],[45,2991870],[46,2991870],[47,2991870],[48,2991870]];

const SOURCES = {
  // Price, volume, order-book depth (±2%) per exchange.
  async market(get) {
    const c = await get(`${CG}/coins/quai-network?localization=false&tickers=false&community_data=false&developer_data=false`);
    const t = await get(`${CG}/coins/quai-network/tickers?depth=true`);
    const m = c.market_data;
    return {
      price: m.current_price.usd, mcap: m.market_cap.usd, vol24: m.total_volume.usd,
      ch24: m.price_change_percentage_24h, ch7: m.price_change_percentage_7d, ch30: m.price_change_percentage_30d,
      ath: m.ath.usd, athDate: m.ath_date.usd, atl: m.atl.usd, atlDate: m.atl_date.usd,
      tickers: (t.tickers || []).filter(x => !x.is_stale && !x.is_anomaly).map(x => ({
        ex: x.market.name, pair: `${x.base}/${x.target}`, vol: x.converted_volume?.usd || 0,
        spread: x.bid_ask_spread_percentage, up: x.cost_to_move_up_usd || 0, down: x.cost_to_move_down_usd || 0,
      })),
    };
  },
  // Daily USD price for the last year: [['YYYY-MM-DD', price], ...].
  async prices(get) {
    const j = await get(`${CG}/coins/quai-network/market_chart?vs_currency=usd&days=365&interval=daily`);
    const byDay = {};
    for (const [ts, p] of j.prices) byDay[new Date(ts).toISOString().slice(0, 10)] = p;
    return Object.entries(byDay);
  },
  // Every transfer into the SOAP burn address: [unix, QUAI, from].
  async burns(get) {
    const txs = await scanAll(get, A.burn, 20);
    return txs.filter(t => lc(t.to?.hash) === A.burn && t.status === 'ok')
      .map(t => [unix(t.timestamp), wei(t.value), lc(t.from.hash)]);
  },
  // SOAP wallet: what it sends out (to burn, to the gas burner, elsewhere) and gets back.
  async soapWallet(get) {
    const txs = await scanAll(get, A.soap, 30);
    const out = [], inn = [];
    for (const t of txs) {
      if (t.status !== 'ok') continue;
      const v = wei(t.value);
      if (v < 1) continue;
      if (lc(t.from.hash) === A.soap) out.push([unix(t.timestamp), lc(t.to?.hash), v]);
      else inn.push([unix(t.timestamp), lc(t.from.hash), v]);
    }
    return { out, in: inn };
  },
  // Gas-burner wallet and staking contract balances + last activity.
  async wallets(get) {
    try { return await walletsQuaiscan(get); } catch (e) {
      const info = async a => (await get(`${EXP}/address/${a}?includeTransactions=false`)).info || {};
      const [g, st] = await Promise.all([info(A.gas), info(A.staking)]);
      return {
        gasBurner: { balance: wei(toWeiString(g.balance_quai)), lastTx: g.last_seen ? unix(g.last_seen) : null },
        staking: { balance: wei(toWeiString(st.balance_quai)), txs: Number(st.tx_count) || 0 },
      };
    }
  },
  // Chain-wide counters: Quaiscan, else the official explorer (no "today" count there).
  async network(get) {
    try {
      const s = await get(`${SCAN}/stats`);
      return { totalTx: Number(s.total_transactions), txToday: Number(s.transactions_today), gasToday: Number(s.gas_used_today), addresses: Number(s.total_addresses) };
    } catch (e) {
      const s = await get(`${EXP}/stats/overview`);
      return { totalTx: Number(s.totalTransactions), txToday: null, gasToday: null, addresses: Number(s.totalQuaiAddresses ?? s.totalAddresses), qiAddresses: Number(s.totalQiAddresses) || null };
    }
  },
};
async function walletsQuaiscan(get) {
    const [g, gt, s, sc] = await Promise.all([
      get(`${SCAN}/addresses/${A.gas}`), get(`${SCAN}/addresses/${A.gas}/transactions`),
      get(`${SCAN}/addresses/${A.staking}`), get(`${SCAN}/addresses/${A.staking}/counters`),
    ]);
    return {
      gasBurner: { balance: wei(g.coin_balance), lastTx: gt.items?.[0] ? unix(gt.items[0].timestamp) : null },
      staking: { balance: wei(s.coin_balance), txs: Number(sc.transactions_count) || 0 },
    };
}
const SOURCES2 = {
  // SOAP revenue (team's own dashboard API): totals by chain + monthly + last 7/30 days.
  async soap(get) {
    const base = 'https://soap.qu.ai/api';
    const r = await get(`${base}/revenues`);
    const now = Math.floor(Date.now() / 1000);
    const months = [];
    for (let d = new Date(Date.UTC(2025, 11, 1)); d.getTime() / 1000 < now; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))
      months.push([d.toISOString().slice(0, 7), d.getTime() / 1000, Math.min(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000, now)]);
    const per = await Promise.all(months.map(([, s, e]) => get(`${base}/revenues/daily?start=${s}&end=${e}`)));
    const [d7, d30, p30] = await Promise.all([
      get(`${base}/revenues/daily?start=${now - 7 * 86400}&end=${now}`),
      get(`${base}/revenues/daily?start=${now - 30 * 86400}&end=${now}`),
      get(`${base}/revenues/daily?start=${now - 60 * 86400}&end=${now - 30 * 86400}`),
    ]);
    const chains = {};
    for (const [k, v] of Object.entries(r.revenues || {})) chains[k] = { usd: v.totalRevenueUsd, blocks: v.blockCount };
    return {
      chains,
      total: Object.values(chains).reduce((a, c) => a + c.usd, 0),
      months: months.map(([ym], i) => [ym, per[i].total?.revenueUsd || 0]),
      last7: d7.total?.revenueUsd || 0, last30: d30.total?.revenueUsd || 0, prev30: p30.total?.revenueUsd || 0,
      last30ByChain: Object.fromEntries(Object.entries(d30.byChain || {}).map(([k, v]) => [k, v.revenueUsd])),
    };
  },
  // Supply (team's supply tracker API): current supply + last 30 days of mining vs burn.
  async supply(get) {
    const base = 'https://supply.qu.ai/api';
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 31 * 86400e3).toISOString().slice(0, 10);
    const [st, sp, ro] = await Promise.all([
      get(`${base}/stats`),
      get(`${base}/supply?period=day&from=${from}&to=${to}&include=burn`),
      get(`${base}/rollups?period=day&from=${from}&to=${to}`),
    ]);
    const mined = {};
    for (const r of ro.rows || []) mined[r.periodStart] = wei(r.coinbaseQuaiMiningRewardSum ?? r.baseBlockRewardSum);
    return {
      supply: wei(st.analytics?.quaiSupplyTotal ?? st.info?.quaiSupplyTotal),
      qi: big(st.analytics?.qiSupplyTotal) / 1000,
      soapBurned: wei(st.analytics?.soapBurnBalance),
      head: Number(st.info?.blockNumber) || null, blockTime: Number(st.info?.avgBlockTime) || null,
      // average block time over complete days (steadier than the live figure, used to date future unlocks)
      blockTime30: (() => { const r = (sp.rows || []).filter(x => !x.partial && x.blockCount > 0); return r.length ? 86400 * r.length / r.reduce((a, x) => a + x.blockCount, 0) : null; })(),
      // [date, supply at day end, burned that day, mined that day, partial day?]
      days: (sp.rows || []).map(r => [r.periodStart, wei(r.quaiTotalEnd), wei(r.burnDelta), mined[r.periodStart] ?? null, !!r.partial]),
    };
  },
  // Hashference public stats (AI API paid with mining / QUAI).
  async hashference(get) {
    const [s, st] = await Promise.all([get('https://hashference.com/v1/stats?days=30'), get('https://hashference.com/v1/staking')]);
    return {
      requests: s.summary?.requests, tokens: s.summary?.tokens,
      daily: (s.daily || []).map(d => [d.day, d.requests]),
      funding: Object.fromEntries((s.funding || []).map(f => [f.source, f.share])),
      devices7d: s.network?.devices?.active7d, x402: s.network?.x402?.requests,
      stakingPlans: (st.plans || []).map(p => [p.principalQuai, p.monthlyMicrousd / 1e6]),
    };
  },
  // x402 Work public stats (pay-with-work payments).
  async x402(get) {
    const s = await get('https://x402.qu.ai/v1/stats?days=30');
    return { payments: s.summary?.payments, services: s.summary?.services, hashference: s.summary?.hashference };
  },
};
Object.assign(SOURCES, SOURCES2);

// Quainance (DEX on Quai): QUAI/USDT pool reserves read from the chain (getReserves),
// all-protocol TVL and swap volume from DefiLlama.
SOURCES.dex = async function dex(get) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'quai_call', params: [{ to: DEX_PAIR, data: '0x0902f1ac' }, 'latest'] }) });
  if (!r.ok) throw new Error('quai rpc -> HTTP ' + r.status);
  const hex = ((await r.json()).result || '').slice(2);
  if (hex.length < 128) throw new Error('getReserves: empty result');
  const usdt = Number(BigInt('0x' + hex.slice(0, 64))) / 1e6;
  const quai = Number(BigInt('0x' + hex.slice(64, 128))) / 1e18;
  const out = { pair: DEX_PAIR, usdt, quai };
  try {
    const v = await get(`${LLAMA}/summary/dexs/quainance?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`);
    Object.assign(out, { vol24: v.total24h, vol7: v.total7d, vol30: v.total30d });
  } catch (e) { out.volError = String(e.message || e).slice(0, 120); }
  try { out.tvl = Number(await get(`${LLAMA}/tvl/quainance`)); } catch (e) { out.tvlError = String(e.message || e).slice(0, 120); }
  return out;
};

// ---------- helpers ----------
function lc(s) { return (s || '').toLowerCase(); }
function unix(iso) { return Math.floor(Date.parse(iso) / 1000); }
function big(x) { if (x == null) return 0; const s = typeof x === 'object' ? x.__big : x; return Number(s); }
function wei(x) {
  if (x == null) return 0;
  const s = String(typeof x === 'object' ? x.__big : x);
  if (!/^\d+$/.test(s)) return Number(s) || 0;
  const p = s.padStart(19, '0');
  return Number(p.slice(0, -18) + '.' + p.slice(-18));
}
// Transactions of an address in Quaiscan's shape. Falls back to the official explorer.
async function scanAll(get, addr, maxPages) {
  try { return await quaiscanAll(get, addr, maxPages); }
  catch (e) { return await explorerAll(get, addr, maxPages * 2); }
}
async function explorerAll(get, addr, maxPages) {
  let all = [], cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const j = await get(`${EXP}/address/${addr}/transactions?limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    for (const t of j.items || []) all.push({
      timestamp: t.timestamp, status: t.status === 1 || t.status === '1' ? 'ok' : 'error',
      value: toWeiString(t.value), from: { hash: t.from_addr }, to: { hash: t.to_addr },
    });
    if (!j.hasMore || !j.nextCursor) break;
    cursor = j.nextCursor;
  }
  return all;
}
function toWeiString(v) { if (v == null) return '0'; const s = String(v); if (/^\d+$/.test(s)) return s; const n = Number(s); return isFinite(n) ? BigInt(Math.round(n)).toString() : '0'; }
async function quaiscanAll(get, addr, maxPages) {
  let all = [], q = '';
  for (let i = 0; i < maxPages; i++) {
    const j = await get(`${SCAN}/addresses/${addr}/transactions${q}`);
    all = all.concat(j.items || []);
    if (!j.next_page_params) break;
    q = '?' + new URLSearchParams(j.next_page_params).toString();
  }
  return all;
}

// ---------- derived numbers ----------
function assemble(p) {
  const ok = k => p[k] && !p[k].error;
  const out = { updatedAt: new Date().toISOString(), addresses: A };
  for (const k of Object.keys(SOURCES)) if (!ok(k)) out[k + 'Error'] = p[k]?.error || 'missing';

  if (ok('dex')) {
    const d = p.dex, price = d.usdt / d.quai;
    // Constant-product pool: buying with X USDT (after the 0.3% fee) moves the price by ((R+X)/R)^2 - 1.
    const buyImpact = usd => { const x = usd * (1 - DEX_FEE); return (Math.pow((d.usdt + x) / d.usdt, 2) - 1) * 100; };
    const cexVol = ok('market') ? p.market.vol24 || 0 : null;
    out.dex = { ...d, price, poolUsd: 2 * d.usdt,
      depthUp: d.usdt * (Math.sqrt(1.02) - 1), depthDown: d.usdt * (1 - Math.sqrt(0.98)),
      impact: [500, 5000].map(usd => ({ usd, pct: buyImpact(usd) })),
      share24: d.vol24 != null && cexVol != null && cexVol + d.vol24 > 0 ? d.vol24 / (cexVol + d.vol24) : null };
  }
  if (ok('market')) {
    const m = p.market;
    const up = m.tickers.reduce((a, t) => a + t.up, 0), down = m.tickers.reduce((a, t) => a + t.down, 0);
    const best = m.tickers.slice().sort((a, b) => b.vol - a.vol)[0];
    // Linear estimate: cost_to_move_up_usd buys a 2% move.
    const impact = (usd, depth) => depth > 0 ? 2 * usd / depth : null;
    out.market = {
      ...m, depthUp: up, depthDown: down,
      impact: [500, 5000].map(usd => ({ usd, oneEx: best ? impact(usd, best.up) : null, allEx: impact(usd, up) })),
    };
  }

  let price = null;
  if (ok('prices')) {
    const days = p.prices, map = Object.fromEntries(days), keys = days.map(d => d[0]);
    price = d => {
      if (map[d] != null) return map[d];
      let lo = 0, hi = keys.length - 1, best = keys[0];
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (keys[mid] <= d) { best = keys[mid]; lo = mid + 1; } else hi = mid - 1; }
      return map[best];
    };
    out.priceChart = days.slice(-120).map(([d, v]) => [d, +v.toPrecision(5)]);
  }

  if (ok('burns') && ok('soapWallet') && ok('soap') && price) {
    const day = t => new Date(t * 1000).toISOString().slice(0, 10);
    const ym = t => day(t).slice(0, 7);
    const burns = p.burns, sw = p.soapWallet;
    const toGas = sw.out.filter(o => o[1] === A.gas);
    const elsewhere = sw.out.filter(o => o[1] !== A.burn && o[1] !== A.gas);
    // QUAI that a recipient later burned itself or sent back to the SOAP wallet is not a leak.
    const back = {};
    for (const [, v, from] of burns) back[from] = (back[from] || 0) + v;
    for (const [, from, v] of sw.in) back[from] = (back[from] || 0) + v;
    const byTo = {};
    for (const [t, to, v] of elsewhere) {
      const r = byTo[to] || (byTo[to] = { to, quai: 0, usd: 0, first: t, last: t });
      r.quai += v; r.usd += v * price(day(t)); r.first = Math.min(r.first, t); r.last = Math.max(r.last, t);
    }
    const leaks = Object.values(byTo).map(r => {
      const net = Math.max(0, r.quai - (back[r.to] || 0));
      return { ...r, returned: Math.min(r.quai, back[r.to] || 0), netQuai: net, netUsd: r.quai ? r.usd * net / r.quai : 0 };
    }).filter(r => r.netQuai >= 1000).sort((a, b) => b.netUsd - a.netUsd);

    const months = {};
    for (const [m, usd] of p.soap.months) months[m] = { m, revenue: usd, burnQuai: 0, burnUsd: 0, gasQuai: 0, gasUsd: 0, leakUsd: 0 };
    const add = (t, v, kind) => {
      const k = ym(t); const r = months[k] || (months[k] = { m: k, revenue: 0, burnQuai: 0, burnUsd: 0, gasQuai: 0, gasUsd: 0, leakUsd: 0 });
      r[kind + 'Quai'] += v; r[kind + 'Usd'] += v * price(day(t));
    };
    for (const [t, v] of burns) add(t, v, 'burn');
    for (const [t, , v] of toGas) add(t, v, 'gas');
    const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
    const mrows = Object.values(months).sort((a, b) => a.m < b.m ? -1 : 1);
    const revenue = p.soap.total;
    const burnedUsd = sum(mrows, r => r.burnUsd + r.gasUsd);
    const leakUsd = sum(leaks, r => r.netUsd);
    const now = Date.now() / 1000;
    const last30Burn = sum(burns.filter(b => b[0] > now - 30 * 86400), b => b[1] * price(day(b[0])))
      + sum(toGas.filter(b => b[0] > now - 30 * 86400), b => b[2] * price(day(b[0])));
    const lastBurn = burns.slice().sort((a, b) => b[0] - a[0])[0];
    out.recon = {
      method: 'burned QUAI x CoinGecko daily close on the burn day',
      revenue, burnedUsd, burnShare: revenue ? burnedUsd / revenue : null,
      burnedQuai: sum(burns, b => b[1]) + sum(toGas, g => g[2]),
      directBurnQuai: sum(burns, b => b[1]), gasQuai: sum(toGas, g => g[2]), gasUsd: sum(mrows, r => r.gasUsd),
      burnedAtTodayUsd: ok('market') ? sum(burns, b => b[1]) * p.market.price : null,
      leakUsd, leaks: leaks.slice(0, 12),
      untracedUsd: revenue - burnedUsd - leakUsd,
      last30: { revenue: p.soap.last30, burnedUsd: last30Burn },
      lastBurn: lastBurn ? { t: lastBurn[0], quai: lastBurn[1] } : null,
      // burn days for chart markers (last ~130 days), including transfers to the gas burner
      burnDays: [...new Set(burns.map(b => b[0]).concat(toGas.map(g => g[0])).filter(t => t > now - 130 * 86400).map(day))].sort(),
      lastLeak: leaks.length ? Math.max(...leaks.map(l => l.last)) : null,
      recentBurns: burns.slice().sort((a, b) => b[0] - a[0]).slice(0, 8).map(([t, v, f]) => ({ t, quai: v, from: f })),
      months: mrows,
    };
  }
  if (ok('soap')) out.soap = p.soap;

  if (ok('supply')) {
    // Drop today (still running); past days flagged partial by the indexer are kept.
    const s = p.supply, full = s.days.filter((d, i) => !(d[4] && i === s.days.length - 1));
    const last = full.slice(-30);
    const mined = last.reduce((a, d) => a + (d[3] || 0), 0), burned = last.reduce((a, d) => a + d[2], 0);
    // Supply change over the window also includes genesis unlocks and Qi<->QUAI conversions
    // (lumpy), so the yearly rate uses mining minus SOAP burns only.
    const base = full[full.length - last.length - 1]; // the day before the window
    const change = base && last.length ? last[last.length - 1][1] - base[1] : null;
    const net = mined - burned;
    // Unlocks: estimated date from the current head block and average block time.
    const bt = s.blockTime30 || s.blockTime || 5.2, head = s.head;
    const at = blk => head ? Math.round(Date.now() / 1000 + (blk - head) * bt) : null;
    // Past unlock dates: the tracker's own calendar (UNLOCK_DATES, then +30 days per month); future ones from block time.
    const pastDate = m => UNLOCK_DATES[m] ? Date.parse(UNLOCK_DATES[m] + 'T00:00:00Z') / 1000 : Date.parse('2026-09-30T00:00:00Z') / 1000 + (m - 20) * 2592000;
    const sched = UNLOCKS.map(([m, q]) => { const block = m * BLOCKS_PER_MONTH; return { m, block, t: head && block <= head ? pastDate(m) : at(block), quai: q }; });
    const now = Date.now() / 1000;
    const future = head ? sched.filter(u => u.block > head) : [];
    const past = head ? sched.filter(u => u.block <= head) : [];
    const in30 = past.filter(u => u.t > now - last.length * 86400).reduce((a, u) => a + u.quai, 0);
    const next12 = future.filter(u => u.t < now + 365 * 86400).reduce((a, u) => a + u.quai, 0);
    const other = change != null ? change - net : null;
    out.supply = {
      ...s, days: s.days,
      d30: { days: last.length, mined, burned, net, change, other, unlocked: in30, otherRest: other != null ? other - in30 : null,
        coverage: other != null && mined + Math.max(0, other) > 0 ? burned / (mined + Math.max(0, other)) : null,
        netInflationYr: last.length ? net / last.length * 365 / s.supply : null },
      unlocks: {
        locked: future.reduce((a, u) => a + u.quai, 0), next: future[0] || null, last: past[past.length - 1] || null,
        next12, next12Pct: next12 / s.supply, final: future.length ? future[future.length - 1].t : null,
        upcoming: future, recent: past.slice(-6),
        // supply growth over the next year if mining and burns stay at the 30-day pace
        dilution12: last.length ? (net / last.length * 365 + next12) / s.supply : null,
      },
    };
  }
  for (const k of ['wallets', 'network', 'hashference', 'x402']) if (ok(k)) out[k] = p[k];
  return out;
}

async function collect(get) {
  const parts = {};
  await Promise.all(Object.entries(SOURCES).map(async ([k, f]) => {
    try { parts[k] = await f(get); } catch (e) { parts[k] = { error: String(e.message || e).slice(0, 200) }; }
  }));
  return parts;
}

async function getJson(url) {
  const headers = { 'user-agent': 'qoge-site-quai-dashboard/1.0 (+https://www.qoge.fun/research/quai-live/)', accept: 'application/json' };
  // Optional free CoinGecko Demo key (Vercel env COINGECKO_API_KEY): shared Vercel IPs often hit the public rate limit (HTTP 429).
  if (url.startsWith(CG) && process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 && attempt < 2) { await new Promise(r => setTimeout(r, 2500 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`${url.replace(/\?.*/, '')} -> HTTP ${res.status}`);
    return res.json();
  }
}

// ---------- history (Upstash Redis, same database as the Discord/Telegram bots) ----------
// One record per UTC day in hash quai:hist, overwritten on every run, so the last run of the day wins.
// A daily Vercel cron (vercel.json) makes sure every day gets at least one run.
const R_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function redis(...cmd) {
  const r = await fetch(R_URL, { method: 'POST', headers: { authorization: 'Bearer ' + R_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error('redis: ' + j.error);
  return j.result;
}
function dayRecord(d) {
  const n = v => (v == null || !isFinite(v) ? undefined : Math.round(v * 1000) / 1000);
  return JSON.stringify({
    p: n(d.market?.price), mc: n(d.market?.mcap), v: n(d.market?.vol24), du: n(d.market?.depthUp), dd: n(d.market?.depthDown),
    dx: n(d.dex?.poolUsd), dxv: n(d.dex?.vol24), tvl: n(d.dex?.tvl),
    cov: n(d.supply?.d30?.coverage), b30: n(d.supply?.d30?.burned), sup: n(d.supply?.supply), lk: n(d.supply?.unlocks?.locked),
    r30: n(d.soap?.last30), lu: n(d.recon?.leakUsd), bs: n(d.recon?.burnShare),
    hf: n(d.hashference?.requests), x4: n(d.x402?.payments), tx: n(d.network?.txToday),
  });
}
async function history(data) {
  if (!R_URL || !R_TOKEN) return null;
  await redis('HSET', 'quai:hist', new Date().toISOString().slice(0, 10), dayRecord(data));
  const flat = await redis('HGETALL', 'quai:hist') || [];
  const out = [];
  for (let i = 0; i < flat.length; i += 2) { try { out.push([flat[i], JSON.parse(flat[i + 1])]); } catch (e) {} }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// ---------- failure alerts (Telegram, same bot as QNN Weekly) ----------
// On the daily cron run the server checks every source and sends the owner ONE private message
// if something is broken or stale. Silent when everything works.
// Test by hand: /api/quai?save=1&test=1&key=<DIGEST_SECRET>  (always sends, even when all is fine).
const SECTION_RU = { market: 'Цена и биржи (CoinGecko)', prices: 'Цены по дням (CoinGecko)', burns: 'Сжигания (обозреватель блоков)',
  soapWallet: 'Кошелёк SOAP (обозреватель блоков)', wallets: 'Кошельки (обозреватель блоков)', network: 'Сеть (обозреватель блоков)',
  soap: 'Выручка SOAP (soap.qu.ai)', supply: 'Предложение (supply.qu.ai)', hashference: 'Hashference', x402: 'x402', dex: 'DEX Quainance' };
function health(d) {
  const p = [];
  for (const k of Object.keys(SOURCES)) if (d[k + 'Error']) p.push(`❌ ${SECTION_RU[k] || k}: ${String(d[k + 'Error']).slice(0, 140)}`);
  const days = d.supply?.days; const lastDay = days?.length ? days[days.length - 1][0] : null;
  if (lastDay && Date.now() - Date.parse(lastDay + 'T00:00:00Z') > 2 * 864e5) p.push(`⚠️ supply.qu.ai: последний день в данных ${lastDay} — источник не обновляется`);
  if (d.soap && !d.soapError && !(d.soap.last7 > 0)) p.push('⚠️ SOAP: выручка за 7 дней = 0 — либо выкуп остановлен, либо сломался API');
  if (d.market && !d.marketError && !(d.market.price > 0)) p.push('⚠️ CoinGecko: нет цены QUAI');
  if (d.dex && !d.dexError && !(d.dex.poolUsd > 1000)) p.push(`⚠️ Пул QUAI/USDT на Quainance почти пуст: ${Math.round(d.dex.poolUsd || 0)} $`);
  if (d.historyError) p.push('❌ История (Redis): ' + d.historyError.slice(0, 140));
  return p;
}
async function notifyOwner(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, owner = process.env.TELEGRAM_OWNER_ID;
  if (!token || !owner) return 'TELEGRAM_BOT_TOKEN / TELEGRAM_OWNER_ID not set';
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: owner, text, link_preview_options: { is_disabled: true } }) });
  return r.ok ? 'sent' : 'telegram HTTP ' + r.status;
}

// ---------- where "sent elsewhere" QUAI went next, and who the non-SOAP burners are ----------
// Uses the official explorer's address labels (e.g. "Gate", "Kraken" for exchange wallets).
async function enrich(d) {
  if (!d.recon) return;
  const labels = {}, label = async a => {
    if (!(a in labels)) { try { const i = await getJson(`${EXP}/address/${a}?includeTransactions=false`); labels[a] = i.info?.label || null; } catch (e) { labels[a] = null; } }
    return labels[a];
  };
  await Promise.all((d.recon.leaks || []).map(async l => {
    try {
      const j = await getJson(`${EXP}/address/${l.to}/transactions?limit=100`);
      const outs = {};
      for (const t of j.items || []) if (lc(t.from_addr) === lc(l.to) && t.to_addr) outs[lc(t.to_addr)] = (outs[lc(t.to_addr)] || 0) + wei(toWeiString(t.value));
      const list = Object.entries(outs).sort((a, b) => b[1] - a[1]), sent = list.reduce((a, x) => a + x[1], 0);
      if (!list.length || sent < l.quai * 0.05) { l.next = { kind: 'kept' }; return; }
      const [top, q] = list[0], lab = await label(top);
      if (lab && q >= sent * 0.5) l.next = { kind: 'exchange', label: lab, quai: q };
      else if (list.length >= 5) l.next = { kind: 'spread', n: list.length, quai: sent };
      else l.next = { kind: 'wallet', to: top, quai: q };
    } catch (e) {}
  }));
  for (const b of d.recon.recentBurns || []) if (lc(b.from) !== A.soap) b.label = await label(lc(b.from));
}

module.exports = async (req, res) => {
  try {
    const data = assemble(await collect(getJson));
    try { await enrich(data); } catch (e) {}
    try { data.history = await history(data); } catch (e) { data.historyError = String(e.message || e).slice(0, 200); }
    const url = req.url || '', cron = /[?&]save=1/.test(url);
    data.health = health(data);
    if (cron) {
      const key = (url.match(/[?&]key=([^&]+)/) || [])[1];
      const byCron = /vercel-cron/i.test(req.headers?.['user-agent'] || '');
      const byOwner = !!process.env.DIGEST_SECRET && key === process.env.DIGEST_SECRET;
      const test = byOwner && /[?&]test=1/.test(url);
      if ((byCron || byOwner) && (data.health.length || test)) {
        const body = data.health.length ? data.health.join('\n') : '✅ Все источники работают.';
        try { data.notified = await notifyOwner('Дашборд QUAI — проверка источников\n\n' + body + '\n\nhttps://www.qoge.fun/research/quai-live/'); }
        catch (e) { data.notified = String(e.message || e); }
      }
    }
    res.setHeader('Cache-Control', cron ? 'no-store' : 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(err.message || err) });
  }
};
module.exports.SOURCES = SOURCES;
module.exports.assemble = assemble;
module.exports.collect = collect;
