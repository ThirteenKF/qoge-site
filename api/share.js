// Vercel Edge Function: share page for X/Telegram. Served at /m?d=&r=&s=&l=&p= (rewrite in vercel.json).
// Crawlers read the Open Graph / Twitter tags and show the generated card from /api/og;
// people who click the link are sent straight to the home page.
export const config = { runtime: 'edge' };

const TITLE = {
  en: "$QOGE ship's log · day {d}", ru: 'Бортовой журнал $QOGE · день {d}', es: 'Diario de a bordo $QOGE · día {d}',
  pt: 'Diário de bordo $QOGE · dia {d}', zh: '$QOGE 航行日志 · 第 {d} 天',
};
const DESC = {
  en: 'A stranded dog is building a rocket home from Mars. Join ground control.',
  ru: 'Пёс застрял на Марсе и строит ракету домой. Присоединяйся к центру управления.',
  es: 'Un perro atrapado en Marte construye un cohete para volver. Únete al centro de control.',
  pt: 'Um cachorro preso em Marte constrói um foguete para voltar. Entre no controle da missão.',
  zh: '一只被困火星的狗正在造火箭回家。加入地面控制。',
};
const int = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export default function handler(req) {
  const url = new URL(req.url), q = url.searchParams;
  const l = TITLE[q.get('l')] ? q.get('l') : 'en';
  const d = int(q.get('d'), 1, 100000, 1), r = int(q.get('r'), 0, 6, 0), s = int(q.get('s'), 1, 100000, 1), p = int(q.get('p'), 0, 100, 0);
  const img = url.origin + '/api/og?d=' + d + '&r=' + r + '&s=' + s + '&l=' + l + '&p=' + p;
  const title = TITLE[l].replace('{d}', d), desc = DESC[l];
  const html = '<!doctype html><html lang="' + l + '"><head><meta charset="utf-8">' +
    '<title>' + esc(title) + '</title>' +
    '<meta name="description" content="' + esc(desc) + '">' +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="$QOGE">' +
    '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '">' +
    '<meta property="og:url" content="' + esc(url.href) + '">' +
    '<meta property="og:image" content="' + esc(img) + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="675">' +
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@QOGEofficial">' +
    '<meta name="twitter:title" content="' + esc(title) + '"><meta name="twitter:description" content="' + esc(desc) + '">' +
    '<meta name="twitter:image" content="' + esc(img) + '">' +
    '<meta http-equiv="refresh" content="0;url=/"></head>' +
    '<body style="background:#141110;color:#f4f0ec;font-family:sans-serif"><a href="/" style="color:#f5d33a">www.qoge.fun</a>' +
    '<script>location.replace("/")</script></body></html>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300, s-maxage=86400' } });
}
