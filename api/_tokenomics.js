// QUAI tokenomics passport: every tokenomics rule the dashboard uses lives here and nowhere else.
// api/quai.js computes unlocks, supply growth and coverage from it; api/quai-watch.js warns when the
// real world stops matching it (a fork, a new schedule, an unlock that did not arrive).
// Files in api/ that start with "_" are not routes on Vercel, so this is a plain module.
//
// HOW TO UPDATE after a fork or any tokenomics change (tools/quai-dashboard.md, "Tokenomics passport"):
//   1. change the numbers below from the official source (supply.qu.ai, docs.qu.ai, qu.ai/blog);
//   2. add the fork to FORKS;
//   3. set UPDATED_AT to the current time (UTC). Every alert found before this moment counts as handled
//      and the warning banner on the dashboard disappears by itself.

const VERSION = '2026-11-27';
const UPDATED_AT = '2026-11-27T16:00:00Z';

// Genesis unlock schedule after the Singularity and Polaris forks, taken from the team's supply tracker
// (supply.qu.ai, GENESIS_UNLOCK_SCHEDULE = post-Singularity schedule minus FOUNDER_UNLOCKS from month 22).
// [schedule month, QUAI]; month m unlocks at block m * 518400. Sum of months 22..48 = 90.39M QUAI.
// Checked 2026-11-27: supply.qu.ai shows the next unlock at block #11,404,800 (month 22) = 3.7M QUAI.
const BLOCKS_PER_MONTH = 518400;
const UNLOCK_DATES = { 13: '2026-03-04', 14: '2026-04-03', 15: '2026-05-03', 16: '2026-06-02', 17: '2026-07-02', 18: '2026-08-01', 19: '2026-08-31', 20: '2026-09-30' };
const UNLOCKS = [[13,51892587],[14,13642587],[15,13141025],[16,13680731],[17,12976319],[18,13123261],[19,12596288],[20,13103525],[21,12578525],
  [22,3735412],[23,3730412],[24,3723120],[25,3660620],[26,3677287],[27,3643954],[28,3643954],[29,3643954],[30,3643954],[31,3643954],
  [32,3649825],[33,3613083],[34,3241870],[35,3241870],[36,3241870],[37,3241870],[38,3241870],[39,3241870],[40,2991870],[41,2991870],
  [42,2991870],[43,2991870],[44,2991870],[45,2991870],[46,2991870],[47,2991870],[48,2991870]];

// Tokenomics changes so far (shown in the dashboard feed). date = when it took effect or was announced.
const FORKS = [
  // announcement date (press release); activation was scheduled for Nov 10–23, 2025
  { id: 'soap', date: '2025-10-24', en: 'SOAP announced: mining revenue buys back QUAI and burns it', ru: 'Анонс SOAP: выручка майнинга выкупает QUAI и сжигает его',
    url: 'https://www.theblock.co/press-releases/376064/quai-network-launches-soap-to-reshape-proof-of-work-economics' },
  { id: 'singularity', date: '2026-03-19', block: 1530500, forgone: 1667159984,
    en: 'Singularity fork: 1.67B QUAI of future genesis unlocks cancelled', ru: 'Форк Singularity: отменено 1,67 млрд QUAI будущих разлоков генезиса',
    url: 'https://qu.ai/blog/singularity-fork-live' },
  { id: 'polaris', date: '2026-10-13', forgone: 236500000,
    en: 'Polaris fork: 236.5M QUAI of founder unlocks cancelled, monthly unlocks ~13M → ~3.7M', ru: 'Форк Polaris: отменено 236,5 млн QUAI разлоков основателей, разлоки в месяц ~13 млн → ~3,7 млн',
    url: 'https://qu.ai/blog/introducing-the-polaris-fork' },
];

// Dashboard numbers that depend on the passport (data-k keys of the tiles, also the X card keys).
const AFFECTS = ['unlock', 'supply', 'cov'];

// Past unlock dates: the tracker's own calendar (UNLOCK_DATES, then +30 days per month).
const pastDate = m => UNLOCK_DATES[m] ? Date.parse(UNLOCK_DATES[m] + 'T00:00:00Z') / 1000 : Date.parse('2026-09-30T00:00:00Z') / 1000 + (m - 20) * 2592000;

// ---------- on-chain check: does the real supply follow the passport? ----------
// supply.days = [day, supply, soapBurned, mined, partial]. For every day the part of the supply change that mining
// and SOAP burns do not explain is the "residual": genesis unlocks plus small noise (Qi conversions, other burns),
// typically ±0.2M QUAI a day. A scheduled unlock must show up as a jump of about its size within a few days of its
// date; a big jump on any other day means coins appeared that the passport does not know about.
function chainCheck(supply) {
  const out = [];
  const days = (supply?.days || []).filter((d, i, a) => !(d[4] && i === a.length - 1));
  if (days.length < 8) return out;
  const res = [];
  for (let i = 1; i < days.length; i++) res.push([days[i][0], days[i][1] - days[i - 1][1] - ((days[i][3] || 0) - (days[i][2] || 0))]);
  const absSorted = res.map(r => Math.abs(r[1])).sort((a, b) => a - b), mad = absSorted[Math.floor(absSorted.length / 2)] || 0;
  const thr = Math.max(1.5e6, 10 * mad * 1.4826);
  const first = Date.parse(res[0][0] + 'T00:00:00Z') / 1000, last = Date.parse(res[res.length - 1][0] + 'T00:00:00Z') / 1000;
  const head = supply.head, bt = supply.blockTime30 || supply.blockTime || 5.2, now = Date.now() / 1000;
  const covered = new Set();
  for (const [m, q] of UNLOCKS) {
    const block = m * BLOCKS_PER_MONTH;
    if (!head || block > head) continue;                                  // not due yet
    const t = UNLOCK_DATES[m] ? pastDate(m) : now - (head - block) * bt;  // when the block was reached
    const a = t - 3 * 86400, b = t + 4 * 86400;
    const win = res.filter(r => { const x = Date.parse(r[0] + 'T00:00:00Z') / 1000; return x >= a && x <= b; });
    win.forEach(r => covered.add(r[0]));                                  // these days are explained by the unlock
    if (a < first) continue;                                              // window starts before our data: can't sum it
    if (b > last) continue;                                               // wait until the whole window is in the data
    const jump = win.reduce((s, r) => s + r[1], 0), day = new Date(t * 1000).toISOString().slice(0, 10);
    if (jump < 0.5 * q) out.push({ id: 'unl-miss-' + m, level: 'red', kind: 'unlock', day,
      ru: `Разлок генезиса №${m} (~${(q / 1e6).toFixed(1)} млн QUAI, около ${day}) не появился в предложении: пришло ~${(Math.max(0, jump) / 1e6).toFixed(1)} млн. Похоже, график разлоков изменился.`,
      en: `Genesis unlock #${m} (~${(q / 1e6).toFixed(1)}M QUAI, around ${day}) did not show up in the supply: only ~${(Math.max(0, jump) / 1e6).toFixed(1)}M arrived. The unlock schedule seems to have changed.` });
    else if (jump > 1.6 * q + thr) out.push({ id: 'unl-big-' + m, level: 'red', kind: 'unlock', day,
      ru: `Около разлока №${m} предложение выросло на ~${(jump / 1e6).toFixed(1)} млн QUAI вместо ~${(q / 1e6).toFixed(1)} млн по графику.`,
      en: `Around unlock #${m} the supply grew by ~${(jump / 1e6).toFixed(1)}M QUAI instead of the scheduled ~${(q / 1e6).toFixed(1)}M.` });
  }
  for (const [day, r] of res) {
    if (covered.has(day)) continue;
    if (r > thr) out.push({ id: 'jump-' + day, level: 'red', kind: 'supply', day,
      ru: `${day}: предложение QUAI выросло на ~${(r / 1e6).toFixed(1)} млн сверх майнинга, а разлока в этот день по графику нет.`,
      en: `${day}: QUAI supply grew by ~${(r / 1e6).toFixed(1)}M beyond mining, with no unlock scheduled that day.` });
    else if (r < -thr) out.push({ id: 'drop-' + day, level: 'yellow', kind: 'supply', day,
      ru: `${day}: предложение QUAI уменьшилось на ~${(-r / 1e6).toFixed(1)} млн сильнее, чем объясняют сжигания SOAP.`,
      en: `${day}: QUAI supply fell by ~${(-r / 1e6).toFixed(1)}M more than SOAP burns explain.` });
  }
  return out;
}

module.exports = { VERSION, UPDATED_AT, BLOCKS_PER_MONTH, UNLOCK_DATES, UNLOCKS, FORKS, AFFECTS, pastDate, chainCheck };
