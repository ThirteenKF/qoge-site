// Fetches live $QOGE market data + 7-day hourly price history from Quainance
// and writes metrics.json and assets/metrics.js (same data; the .js file works
// even when index.html is opened from disk). Runs in GitHub Actions — the
// Quainance API has no CORS, so the browser can't call it directly. Node 20+.
import { writeFile, readFile } from 'node:fs/promises';

const TOKEN = '0x0048848ca70ea1560577b4725a84b23b6bc589e2';
const BASE = 'https://www.quainance.com/api';
const OUT = new URL('../metrics.json', import.meta.url);
const OUT_JS = new URL('../assets/metrics.js', import.meta.url);
const HOURS = 168; // 7 days of 1h candles

async function getJson(path) {
  const res = await fetch(BASE + path, { headers: { 'user-agent': 'qoge-site-metrics/1.0', accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

const num = v => (v == null || v === '' ? null : Number(v));

async function fetchCandles(market) {
  const now = Math.floor(Date.now() / 1000);
  const kind = (market.phase || 'amm').toUpperCase() === 'AMM' ? 'AMM' : 'CURVE';
  const q = `marketAddress=${market.marketAddress}&token=${TOKEN}&quoteToken=${market.quoteAddress}&kind=${kind}&interval=3600&before=${now}&count=${HOURS}`;
  const h = await getJson(`/trade-zone/history?${q}`);
  return (h.payload?.data?.candles || [])
    // [unix time, close price in QUAI, volume in QUAI]
    .map(c => [Number(c.timestamp), Number(c.closePriceQuoteE12) / 1e12, Math.round(Number(c.quoteVolume) / 1e18)])
    .filter(c => c[1] > 0)
    .sort((a, b) => a[0] - b[0]);
}

try {
  const { token: t } = await getJson(`/quai-explorer/trade-zone/token?address=${TOKEN}&view=summary`);
  const m = t.market || {};
  const metrics = {
    source: `https://www.quainance.com/${TOKEN}`,
    updatedAt: new Date().toISOString(),
    marketCapUsd: num(t.market_cap_usd),
    priceUsd: num(t.price_usd),
    priceQuai: num(m.priceQuote),
    liquidityUsd: num(m.liquidityUsd),
    holders: num(t.holder_count),
    totalSupply: num(t.total_supply) / 10 ** (t.decimals ?? 18),
    candles: [],
  };
  if (metrics.marketCapUsd == null && metrics.holders == null) throw new Error('empty response');
  try {
    metrics.candles = await fetchCandles(m);
  } catch (err) {
    console.warn('Price history unavailable, keeping previous candles:', err.message);
    const prev = JSON.parse(await readFile(OUT, 'utf8').catch(() => '{}'));
    metrics.candles = prev.candles || [];
  }
  const json = JSON.stringify(metrics);
  await writeFile(OUT, json + '\n');
  await writeFile(OUT_JS, `window.QOGE_METRICS = ${json};\n`);
  console.log(`metrics updated: mcap $${metrics.marketCapUsd}, ${metrics.holders} holders, ${metrics.candles.length} candles`);
} catch (err) {
  // Keep the last committed files so the site still shows numbers.
  console.warn('Could not refresh metrics, keeping previous files:', err.message);
}
