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
const CG = 'https://api.coingecko.com/api/v3';

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
    const [g, gt, s, sc] = await Promise.all([
      get(`${SCAN}/addresses/${A.gas}`), get(`${SCAN}/addresses/${A.gas}/transactions`),
      get(`${SCAN}/addresses/${A.staking}`), get(`${SCAN}/addresses/${A.staking}/counters`),
    ]);
    return {
      gasBurner: { balance: wei(g.coin_balance), lastTx: gt.items?.[0] ? unix(gt.items[0].timestamp) : null },
      staking: { balance: wei(s.coin_balance), txs: Number(sc.transactions_count) || 0 },
    };
  },
  // Chain-wide counters from the explorer.
  async network(get) {
    const s = await get(`${SCAN}/stats`);
    return { totalTx: Number(s.total_transactions), txToday: Number(s.transactions_today), gasToday: Number(s.gas_used_today), addresses: Number(s.total_addresses) };
  },
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
async function scanAll(get, addr, maxPages) {
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
    const bt = s.blockTime || 5.2, head = s.head;
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
  const res = await fetch(url, { headers: { 'user-agent': 'qoge-site-quai-dashboard/1.0 (+https://www.qoge.fun/research/quai-live/)', accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url.replace(/\?.*/, '')} -> HTTP ${res.status}`);
  return res.json();
}

module.exports = async (req, res) => {
  try {
    const data = assemble(await collect(getJson));
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(err.message || err) });
  }
};
module.exports.SOURCES = SOURCES;
module.exports.assemble = assemble;
module.exports.collect = collect;
