// Rebuilds assets/quai-hist.js (history backfill for research/quai-live/).
//
// The team APIs have no CORS and refuse unknown servers, so this runs in a browser
// on each API's own origin (DevTools console, or a Claude browser tool):
//   1. open https://supply.qu.ai/dashboard, paste PART 1, copy the printed JSON;
//   2. open https://soap.qu.ai/,           paste PART 2, copy the printed JSON;
//   3. merge them into assets/quai-hist.js:
//        window.QUAI_HIST_BASE = {"from":..., "to":..., "note":..., "cov":[...], "rev30":[...]};
//      `from`/`to` must match both arrays (same length, one value per day).
// Days after `to` are filled automatically from Redis (api/quai.js, hash quai:hist),
// so a rebuild is only needed if the formula changes or Redis history is lost.

// ---------- PART 1: buyback coverage, rolling 30 days (run on supply.qu.ai) ----------
async function part1(from = '2026-01-17', to = new Date(Date.now() - 864e5).toISOString().slice(0, 10)) {
  const W = x => { const s = String(x && x.__big != null ? x.__big : x); if (!/^\d+$/.test(s)) return Number(s) || 0;
    const p = s.padStart(19, '0'); return Number(p.slice(0, -18) + '.' + p.slice(-18)); };
  const start = new Date(Date.parse(from) - 31 * 864e5).toISOString().slice(0, 10);
  const sp = await fetch(`/api/supply?period=day&from=${start}&to=${to}&include=burn`).then(r => r.json());
  const ro = await fetch(`/api/rollups?period=day&from=${start}&to=${to}`).then(r => r.json());
  const R = {}; for (const r of ro.rows || []) R[r.periodStart] = r;
  // [date, supply at day end, burned that day, mined that day]
  const d = (sp.rows || []).map(r => { const q = R[r.periodStart] || {};
    return [r.periodStart, W(r.quaiTotalEnd), W(r.burnDelta), W(q.coinbaseQuaiMiningRewardSum ?? q.baseBlockRewardSum)]; });
  const dates = [], cov = [];
  for (let i = 30; i < d.length; i++) {
    if (d[i][0] < from || d[i][0] > to) continue;
    const w = d.slice(i - 29, i + 1);
    const mined = w.reduce((a, x) => a + x[3], 0), burned = w.reduce((a, x) => a + x[2], 0);
    const other = (d[i][1] - d[i - 30][1]) - (mined - burned);   // unlocks + Qi->QUAI + anything else
    dates.push(d[i][0]); cov.push(+(burned / (mined + Math.max(0, other))).toFixed(3));
  }
  const out = { from: dates[0], to: dates[dates.length - 1], cov };
  console.log(JSON.stringify(out)); return out;
}

// ---------- PART 2: SOAP revenue, rolling 30 days, USD (run on soap.qu.ai) ----------
async function part2(from = '2026-01-17', to = new Date(Date.now() - 864e5).toISOString().slice(0, 10)) {
  const t0 = Date.parse(from) / 1000 - 29 * 86400, t1 = Date.parse(to) / 1000;
  const days = []; for (let t = t0; t <= t1; t += 86400) days.push(t);
  const rev = {};
  for (let i = 0; i < days.length; i += 25) await Promise.all(days.slice(i, i + 25).map(async t => {
    const j = await fetch(`/api/revenues/daily?start=${t}&end=${t + 86400}`).then(r => r.json());
    rev[new Date(t * 1000).toISOString().slice(0, 10)] = Math.round(j.total?.revenueUsd || 0);
  }));
  const ks = Object.keys(rev).sort(), rev30 = [];
  for (let i = 29; i < ks.length; i++) { let s = 0; for (let j = i - 29; j <= i; j++) s += rev[ks[j]]; rev30.push(s); }
  const out = { from: ks[29], to: ks[ks.length - 1], rev30 };
  console.log(JSON.stringify(out)); return out;
}
