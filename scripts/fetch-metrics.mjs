// Fetches live $QOGE market data from Quainance and writes metrics.json.
// Runs in GitHub Actions (server-side, so no CORS issues). Node 20+.
import { writeFile, readFile } from 'node:fs/promises';

const TOKEN = '0x0048848ca70ea1560577b4725a84b23b6bc589e2';
const BASE = 'https://www.quainance.com/api';
const OUT = new URL('../metrics.json', import.meta.url);
// Same data as a script: works even when index.html is opened from disk (file://).
const OUT_JS = new URL('../assets/metrics.js', import.meta.url);

async function getJson(path) {
  const res = await fetch(BASE + path, { headers: { 'user-agent': 'qoge-site-metrics/1.0', accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

const num = v => (v == null || v === '' ? null : Number(v));

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
  };
  if (metrics.marketCapUsd == null && metrics.holders == null) throw new Error('empty response');
  const json = JSON.stringify(metrics, null, 2);
  await writeFile(OUT, json + '\n');
  await writeFile(OUT_JS, `window.QOGE_METRICS = ${json};\n`);
  console.log('metrics.json updated', metrics);
} catch (err) {
  // Keep the last committed metrics.json so the site still shows numbers.
  console.warn('Could not refresh metrics, keeping previous file:', err.message);
  console.log(await readFile(OUT, 'utf8').catch(() => '(no previous file)'));
}
