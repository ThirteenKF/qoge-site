// Vercel Serverless Function: live $QOGE metrics from Quainance.
// GET /api/metrics -> same JSON shape as metrics.json. Cached at Vercel's edge
// for 10 min, so Quainance is called at most a few times per hour.
const TOKEN = '0x0048848ca70ea1560577b4725a84b23b6bc589e2';
const BASE = 'https://www.quainance.com/api';
const num = v => (v == null || v === '' ? null : Number(v));

async function getJson(path) {
  const res = await fetch(BASE + path, { headers: { 'user-agent': 'qoge-site-metrics/1.0', accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

module.exports = async (req, res) => {
  try {
    const { token: t } = await getJson(`/quai-explorer/trade-zone/token?address=${TOKEN}&view=summary`);
    const m = t.market || {};
    let candles = [];
    try {
      const now = Math.floor(Date.now() / 1000);
      const kind = (m.phase || 'amm').toUpperCase() === 'AMM' ? 'AMM' : 'CURVE';
      const h = await getJson(`/trade-zone/history?marketAddress=${m.marketAddress}&token=${TOKEN}&quoteToken=${m.quoteAddress}&kind=${kind}&interval=3600&before=${now}&count=168`);
      candles = (h.payload?.data?.candles || [])
        .map(c => [Number(c.timestamp), Number(c.closePriceQuoteE12) / 1e12, Math.round(Number(c.quoteVolume) / 1e18)])
        .filter(c => c[1] > 0)
        .sort((a, b) => a[0] - b[0]);
    } catch (e) { /* chart is optional */ }
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.status(200).json({
      source: `https://www.quainance.com/${TOKEN}`,
      updatedAt: new Date().toISOString(),
      marketCapUsd: num(t.market_cap_usd),
      priceUsd: num(t.price_usd),
      priceQuai: num(m.priceQuote),
      liquidityUsd: num(m.liquidityUsd),
      holders: num(t.holder_count),
      totalSupply: num(t.total_supply) / 10 ** (t.decimals ?? 18),
      candles,
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(err.message || err) });
  }
};
