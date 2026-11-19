// QNN Weekly archive page: /weekly (latest issue + list) and /weekly/N (one issue).
// Data: Redis list tg:issues, written by api/telegram.mjs when a digest is published.
// Rewrites in vercel.json. No secrets here; the texts are already public in the Telegram channel.

export const config = { runtime: 'nodejs' };

const env = process.env;
const R_URL = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
async function redis(...cmd) {
  const res = await fetch(R_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + R_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await res.json();
  if (j.error) throw new Error('redis: ' + j.error);
  return j.result;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// same mini-markdown as the bot: [label](url), **bold**; plus bare links and line breaks
function render(s) {
  const links = [];
  let h = esc(s).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, l, u) => {
    links.push(`<a href="${u}" target="_blank" rel="noopener">${l}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, '')}</a>`);
  h = h.replace(/\u0000(\d+)\u0000/g, (_, i) => links[+i]);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return h.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
}
const plain = s => String(s).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '');

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const fmtDate = d => { const [y, m, dd] = String(d).split('-'); return y && m ? `${+dd} ${MONTHS[+m - 1]} ${y}` : d; };

function page({ title, desc, body, canonical }) {
  return `<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" href="/assets/logo.jpg">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="https://www.qoge.fun/assets/og.jpg">
<meta property="og:url" content="${canonical}"><meta name="twitter:card" content="summary_large_image">
<style>
*{box-sizing:border-box}
body{margin:0;background:#0d0f1a;color:#f4f0ec;font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
 background-image:radial-gradient(ellipse at 80% -10%,rgba(58,166,217,.18),transparent 55%),radial-gradient(ellipse at 0% 110%,rgba(228,87,46,.14),transparent 50%)}
a{color:#3AA6D9}
.wrap{max-width:1080px;margin:0 auto;padding:24px 20px 60px}
header{display:flex;align-items:center;gap:14px;justify-content:space-between;flex-wrap:wrap;margin-bottom:28px}
.brand{display:flex;align-items:center;gap:12px;color:#f4f0ec;text-decoration:none;font-weight:800;font-size:20px}
.brand img{width:40px;height:40px;border-radius:50%}
.brand span{color:#E4572E}
.sub{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:999px;color:#06140a;font-weight:800;text-decoration:none;
 background:linear-gradient(110deg,#1f9d3a,#3cc94e,#86e35a,#2fb24a)}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:28px;align-items:start}
article{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:28px 30px}
.tag{display:inline-block;font:600 12px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#E4572E;margin-bottom:10px}
article h1{margin:0 0 6px;font-size:clamp(26px,3.4vw,38px);line-height:1.15}
.date{color:#a9a4b8;font-size:14px;margin-bottom:22px}
article p{margin:0 0 14px;overflow-wrap:anywhere}
article b{color:#ffd76a}
aside{position:sticky;top:20px}
aside h2{font-size:14px;font:600 13px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#a9a4b8;margin:4px 0 12px}
aside a{display:block;padding:12px 14px;border-radius:12px;color:#f4f0ec;text-decoration:none;border:1px solid rgba(255,255,255,.08);margin-bottom:8px;background:rgba(255,255,255,.03)}
aside a:hover,aside a.on{border-color:#3AA6D9;background:rgba(58,166,217,.1)}
aside a small{display:block;color:#a9a4b8;font-size:13px}
.empty{text-align:center;padding:60px 20px}
footer{margin-top:40px;color:#a9a4b8;font-size:14px;text-align:center}
@media (max-width:767px){.grid{grid-template-columns:minmax(0,1fr)}aside{position:static}article{padding:22px 18px}body{font-size:16px}}
</style></head><body><div class="wrap">
<header><a class="brand" href="/"><img src="/assets/logo.jpg" alt="">QNN&nbsp;<span>Weekly</span></a>
<a class="sub" href="https://t.me/QOGEofficial" target="_blank" rel="noopener">✈ Подписаться в Telegram</a></header>
${body}
<footer><a href="/">qoge.fun</a> · <a href="/research/">Крипторесёрч</a> · <a href="https://x.com/QOGEofficial">X</a> · <a href="https://t.me/QOGEofficial">Telegram</a><br>Не финансовый совет. Новости, проверенные по источникам.</footer>
</div></body></html>`;
}

export async function GET(request) {
  const url = new URL(request.url);
  const want = parseInt(url.searchParams.get('n') || '', 10);
  let issues = [];
  try {
    const raw = await redis('LRANGE', 'tg:issues', '0', '199');
    issues = (raw || []).map(v => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
  } catch (e) { console.error(e); }

  const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 's-maxage=300, stale-while-revalidate=3600' } });

  if (!issues.length) {
    return html(page({
      title: 'QNN Weekly — недельный дайджест QOGE', desc: 'Главное за неделю в ИИ, IT и крипте, проверка слухов и новости $QOGE.',
      canonical: 'https://www.qoge.fun/weekly',
      body: '<div class="empty"><h1>QNN Weekly</h1><p>Первый выпуск появится здесь после публикации в Telegram.</p></div>',
    }));
  }
  const cur = Number.isFinite(want) ? issues.find(i => i.n === want) : issues[0];
  if (!cur) return html(page({ title: 'Выпуск не найден — QNN Weekly', desc: '', canonical: 'https://www.qoge.fun/weekly', body: '<div class="empty"><h1>Выпуск не найден</h1><p><a href="/weekly">Все выпуски</a></p></div>' }), 404);

  const lines = String(cur.t).split('\n');
  const head = plain(lines[0]);
  const text = lines.slice(1).join('\n').trim();
  const desc = plain(text).replace(/\s+/g, ' ').slice(0, 180);
  const list = issues.slice(0, 30).map(i => `<a href="/weekly/${i.n}"${i === cur ? ' class="on"' : ''}>Выпуск #${i.n}<small>${esc(fmtDate(i.date))}</small></a>`).join('');
  return html(page({
    title: `${head} — QNN Weekly`, desc, canonical: `https://www.qoge.fun/weekly/${cur.n}`,
    body: `<div class="grid"><article><div class="tag">Выпуск #${cur.n}</div><h1>${esc(head)}</h1><div class="date">${esc(fmtDate(cur.date))}</div>${render(text)}</article>
<aside><h2>Все выпуски</h2>${list}</aside></div>`,
  }));
}
