// Vercel Edge Function: share page for one QUAI Live number. Served at /q?k=<metric>&l=<en|ru> (rewrite in vercel.json).
// X/Telegram read the Open Graph tags and show the card from /api/qcard; people who open the link land on the dashboard.
export const config = { runtime: 'edge' };

const KEYS = { hf7: 'hf', hf30: 'hf', burn: 'soap', cov: 'supply', price: 'pulse', liq: 'market', supply: 'supply', unlock: 'supply' };
const TITLE = {
  en: { hf7: 'Hashference demand, last 7 days', hf30: 'Hashference requests, 30 days', burn: 'How much SOAP revenue is burned', cov: 'How much new QUAI is burned',
    price: 'QUAI price', liq: 'QUAI order-book depth', supply: 'QUAI supply growth', unlock: 'Next QUAI genesis unlock' },
  ru: { hf7: 'Спрос на Hashference за 7 дней', hf30: 'Запросы к Hashference за 30 дней', burn: 'Сколько выручки SOAP сжигается', cov: 'Сколько новых QUAI сгорает',
    price: 'Цена QUAI', liq: 'Глубина стаканов QUAI', supply: 'Рост предложения QUAI', unlock: 'Следующий разлок QUAI' },
};
const DESC = {
  en: 'Live numbers of the Quai Network: Hashference, SOAP buyback audit, supply, liquidity. Independent dashboard by QNN · $QOGE.',
  ru: 'Живые данные сети Quai: Hashference, проверка выкупа SOAP, предложение, ликвидность. Независимый дашборд QNN · $QOGE.',
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export default function handler(req) {
  const url = new URL(req.url), q = url.searchParams;
  const l = q.get('l') === 'ru' ? 'ru' : 'en', k = KEYS[q.get('k')] ? q.get('k') : 'hf7';
  // hour bucket in the image URL: X caches images by URL, so a share made later shows the newer numbers
  const v = Math.floor(Date.now() / 36e5);
  const img = url.origin + '/api/qcard?k=' + k + '&l=' + l + '&v=' + v;
  const page = url.origin + '/research/quai-live/?lang=' + l + '#' + KEYS[k];
  const title = TITLE[l][k] + ' · QNN Quai Live', desc = DESC[l];
  const html = '<!doctype html><html lang="' + l + '"><head><meta charset="utf-8">' +
    '<title>' + esc(title) + '</title><meta name="description" content="' + esc(desc) + '">' +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="QNN · $QOGE">' +
    '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '">' +
    '<meta property="og:url" content="' + esc(url.href) + '">' +
    '<meta property="og:image" content="' + esc(img) + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="675">' +
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@QOGEofficial">' +
    '<meta name="twitter:title" content="' + esc(title) + '"><meta name="twitter:description" content="' + esc(desc) + '">' +
    '<meta name="twitter:image" content="' + esc(img) + '">' +
    '<meta http-equiv="refresh" content="0;url=' + esc(page) + '"></head>' +
    '<body style="background:#050505;color:#f2f2f2;font-family:sans-serif"><a href="' + esc(page) + '" style="color:#e3262b">QNN · Quai Live</a>' +
    '<script>location.replace(' + JSON.stringify(page) + ')</script></body></html>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=600' } });
}
