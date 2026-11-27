// Vercel Edge Function: share card PNG (1200x675) for one number of the QUAI Live dashboard.
// GET /api/qcard?k=<metric>&l=<en|ru>   metric: hf7 | hf30 | burn | cov | price | liq | supply | unlock
// Values are computed here from /api/quai (never taken from the URL, so nobody can make a QNN card with fake numbers).
// Shared through /q?k=&l= (api/qshare.js) so X/Telegram show the card under the link.
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const BG = '#050505', PANEL = '#0d0d0d', PAPER = '#f2f2f2', TXT2 = '#c9c9c9', MUTE = '#8f8f8f', RED = '#e3262b', GREEN = '#5bd16a', BLUE = '#2e97ca', YEL = '#d6b42a';
const KEYS = ['hf7', 'hf30', 'burn', 'cov', 'price', 'liq', 'supply', 'unlock'];

const T = {
  en: {
    tag: 'QNN · QUAI LIVE', sub: 'INDEPENDENT QUAI DASHBOARD', at: 'data as of', site: 'qoge.fun/research/quai-live',
    hf7: 'Hashference requests, last 7 full days', hf7s: (b, x) => (x ? '×' + x + ' vs the week before (' + b + ')' : 'vs ' + b + ' the week before'),
    hf30: 'Hashference requests, 30 days', hf30s: (n) => 'all received requests · ' + n + ' AI tokens',
    burn: 'SOAP buyback: share of revenue burned', burns: (b, r) => b + ' of ' + r + ' revenue burned in 30 days',
    cov: 'New QUAI offset by SOAP burns', covs: (b, n) => b + ' burned of ' + n + ' new QUAI in 30 days',
    price: 'QUAI price', prices: (c30, c24) => '30 days: ' + c30 + ' · 24h: ' + c24,
    liq: 'Order books within +2% of the price', liqs: (a, b) => 'a $5,000 market buy moves the price ' + a + '–' + b,
    supply: 'QUAI supply growth, next 12 months', supplys: (m, u) => 'mining net of burns ' + m + ' + genesis unlocks ' + u,
    unlock: 'Next QUAI genesis unlock', unlocks: (q, p, d) => q + ' QUAI · ' + p + ' of supply · in ' + d + ' days',
  },
  ru: {
    tag: 'QNN · QUAI LIVE', sub: 'НЕЗАВИСИМЫЙ ДАШБОРД QUAI', at: 'данные на', site: 'qoge.fun/research/quai-live',
    hf7: 'Запросы к Hashference, 7 полных дней', hf7s: (b, x) => (x ? '×' + x + ' к прошлой неделе (' + b + ')' : 'против ' + b + ' неделей раньше'),
    hf30: 'Запросы к Hashference, 30 дней', hf30s: (n) => 'все полученные запросы · ' + n + ' ИИ-токенов',
    burn: 'Выкуп SOAP: сколько выручки сожжено', burns: (b, r) => 'сожжено ' + b + ' из ' + r + ' выручки за 30 дней',
    cov: 'Сколько новых QUAI сгорает', covs: (b, n) => 'SOAP сжёг ' + b + ' из ' + n + ' новых QUAI за 30 дней',
    price: 'Цена QUAI', prices: (c30, c24) => '30 дней: ' + c30 + ' · 24 ч: ' + c24,
    liq: 'Стаканы бирж в пределах +2% от цены', liqs: (a, b) => 'покупка на $5 000 сдвинет цену на ' + a + '–' + b,
    supply: 'Рост предложения QUAI за 12 месяцев', supplys: (m, u) => 'майнинг минус сжигания ' + m + ' + разлоки генезиса ' + u,
    unlock: 'Следующий разлок генезиса QUAI', unlocks: (q, p, d) => q + ' QUAI · ' + p + ' предложения · через ' + d + ' дн.',
  },
};

// number formatting, same rules as the page (RU: decimal comma, "тыс."/"млн", minus sign)
function fmt(L) {
  const ru = L === 'ru', dec = s => (ru ? s.replace('.', ',') : s), minus = s => s.replace('-', '−');
  const grp = n => Math.round(n).toLocaleString(ru ? 'ru-RU' : 'en-US').replace(/ | /g, ru ? ' ' : ',');
  const big = n => { const a = Math.abs(n);
    if (a >= 1e9) return dec((n / 1e9).toFixed(2)) + (ru ? ' млрд' : 'B');
    if (a >= 1e6) return dec((n / 1e6).toFixed(1)) + (ru ? ' млн' : 'M');
    return grp(n); };
  const usd = n => { const a = Math.abs(n);
    if (a >= 1e6) return '$' + dec((n / 1e6).toFixed(2)) + (ru ? ' млн' : 'M');
    if (a >= 1e4) return '$' + grp(n / 1e3) + (ru ? ' тыс.' : 'K');
    if (a >= 1) return '$' + grp(n);
    return '$' + dec(n.toPrecision(3)); };
  const pct = (p, d = 0) => dec((p * 100).toFixed(d)) + '%';
  const sg = (p, d = 1) => minus((p >= 0 ? '+' : '') + dec(p.toFixed(d)) + '%');
  const date = ts => new Date(ts).toLocaleString(ru ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  const day = ts => new Date(ts).toLocaleDateString(ru ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { big, usd, pct, sg, date, day, dec };
}

// complete UTC days only (today is still running), as on the page
function hfWeeks(d) {
  const today = new Date().toISOString().slice(0, 10), o = d.length && d[d.length - 1][0] === today ? 1 : 0, n = d.length;
  const f = (a, b) => d.slice(Math.max(0, a), Math.max(0, b)).reduce((x, y) => x + y[1], 0);
  return { a: f(n - 7 - o, n - o), b: f(n - 14 - o, n - 7 - o), days: d.slice(Math.max(0, n - 14 - o), n - o) };
}

// -> { label, value, color, sub, bars: [[value, color]] }  or null when the data is missing
function metric(k, D, L) {
  const t = T[L], f = fmt(L), m = D.market, s = D.supply, r = D.recon, h = D.hashference;
  if (k === 'hf7' && h?.daily?.length) {
    const w = hfWeeks(h.daily), x = w.b ? w.a / w.b : null;
    return { label: t.hf7, value: f.big(w.a), color: PAPER, sub: t.hf7s(f.big(w.b), x ? f.dec(x.toFixed(1)) : null), subColor: x == null ? TXT2 : x >= 1 ? GREEN : RED,
      bars: w.days.map((d, i) => [d[1], i >= w.days.length - 7 ? BLUE : '#1f4f6b']) };
  }
  if (k === 'hf30' && h?.daily?.length) {
    const n = h.requests ?? h.daily.reduce((a, d) => a + d[1], 0);
    return { label: t.hf30, value: f.big(n), color: PAPER, sub: t.hf30s(h.tokens ? f.big(h.tokens) : '—'), bars: h.daily.map(d => [d[1], BLUE]) };
  }
  if (k === 'burn' && r?.last30?.revenue > 0) {
    const sh = r.last30.burnedUsd / r.last30.revenue;
    return { label: t.burn, value: f.pct(sh), color: sh >= 0.8 ? GREEN : sh >= 0.5 ? YEL : RED, sub: t.burns(f.usd(r.last30.burnedUsd), f.usd(r.last30.revenue)),
      bars: (r.months || []).slice(-12).flatMap(x => [[x.revenue, BLUE], [x.burnUsd + (x.gasUsd || 0), RED]]) };
  }
  if (k === 'cov' && s?.d30?.mined > 0) {
    const d = s.d30, newS = d.mined + (d.unlocked || 0) + Math.max(0, d.otherRest || 0), cv = d.burned / newS;
    return { label: t.cov, value: f.pct(cv), color: cv >= 1 ? GREEN : cv >= 0.5 ? YEL : RED, sub: t.covs(f.big(d.burned), f.big(newS)),
      bars: [[d.burned, RED], [newS, '#333333']], split: true };
  }
  if (k === 'price' && m?.price > 0) {
    const pc = (D.priceChart || []).slice(-60);
    return { label: t.price, value: f.usd(m.price), color: PAPER, sub: t.prices(m.ch30 != null ? f.sg(m.ch30) : '—', m.ch24 != null ? f.sg(m.ch24) : '—'),
      subColor: m.ch30 == null ? TXT2 : m.ch30 >= 0 ? GREEN : RED, line: pc.map(p => p[1]) };
  }
  if (k === 'liq' && m?.depthUp > 0) {
    const im = m.impact && m.impact[1];
    return { label: t.liq, value: f.usd(m.depthUp), color: m.depthUp < 1e4 ? RED : m.depthUp < 5e4 ? YEL : GREEN,
      sub: im ? t.liqs(f.dec(im.allEx.toFixed(1)) + '%', f.dec(Math.round(im.oneEx).toString()) + '%') : '',
      bars: (m.tickers || []).slice(0, 8).map(x => [x.up, BLUE]), names: (m.tickers || []).slice(0, 8).map(x => x.ex) };
  }
  if (k === 'supply' && s?.unlocks?.dilution12 != null && s.d30) {
    const di = s.unlocks.dilution12, ni = s.d30.net / s.d30.days * 365 / s.supply;
    return { label: t.supply, value: f.sg(di * 100), color: di < 0.03 ? GREEN : di < 0.1 ? YEL : RED, sub: t.supplys(f.sg(ni * 100), f.sg((s.unlocks.next12Pct || 0) * 100)) };
  }
  if (k === 'unlock' && s?.unlocks?.next?.t) {
    const nx = s.unlocks.next, days = Math.max(0, Math.ceil((nx.t * 1000 - Date.now()) / 864e5));
    return { label: t.unlock, value: f.day(nx.t * 1000), color: YEL, sub: t.unlocks(f.big(nx.quai), f.dec((nx.quai / s.supply * 100).toFixed(2)) + '%', days),
      bars: (s.unlocks.upcoming || []).slice(0, 12).map(u => [u.quai, YEL]) };
  }
  return null;
}

async function font(family, text) {
  const css = await (await fetch('https://fonts.googleapis.com/css2?family=' + family + '&text=' + encodeURIComponent(text), { signal: AbortSignal.timeout(2500) })).text();
  const mm = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
  if (!mm) throw new Error('font ' + family);
  return (await fetch(mm[1], { signal: AbortSignal.timeout(2500) })).arrayBuffer();
}
const el = (type, style, ...children) => {
  const props = { style: { display: 'flex', ...style } };
  if (children.length === 1) props.children = children[0]; else if (children.length > 1) props.children = children;
  return { type, props };
};

export default async function handler(req) {
  const url = new URL(req.url), q = url.searchParams, origin = url.origin;
  const L = q.get('l') === 'ru' ? 'ru' : 'en', k = KEYS.includes(q.get('k')) ? q.get('k') : 'hf7', t = T[L], f = fmt(L);
  let D = null, M = null;
  try { D = await (await fetch(origin + '/api/quai', { signal: AbortSignal.timeout(3500) })).json();   // X gives up on slow images, so never wait long M = metric(k, D, L); } catch (e) {}
  if (!M) return Response.redirect(origin + '/assets/og.jpg', 302);

  const at = t.at + ' ' + f.date(D.updatedAt || Date.now());
  const vSize = M.value.length <= 7 ? 150 : M.value.length <= 10 ? 120 : M.value.length <= 14 ? 92 : 72;
  const lSize = M.label.length <= 34 ? 40 : 34, sSize = (M.sub || '').length <= 60 ? 30 : 25;

  // chart strip at the bottom: bars, a two-part split bar, or a price line drawn with bars
  const W = 1072, H = 150;
  let chart = null;
  if (M.split) {
    const tot = M.bars[1][0] || 1, part = Math.min(1, M.bars[0][0] / tot);
    chart = el('div', { width: W, height: 34, backgroundColor: '#333333', marginTop: 40 }, el('div', { width: Math.round(W * part), height: 34, backgroundColor: RED }));
  } else if (M.line && M.line.length > 2) {
    const mx = Math.max(...M.line), mn = Math.min(...M.line), rg = (mx - mn) || 1, bw = W / M.line.length;
    chart = el('div', { width: W, height: H, alignItems: 'flex-end' }, ...M.line.map(v => el('div', { width: Math.max(2, bw - 3), marginRight: 3, height: Math.max(4, Math.round((v - mn) / rg * (H - 10)) + 6), backgroundColor: '#3a3a3a', borderTop: '4px solid ' + PAPER })));
  } else if (M.bars && M.bars.length) {
    const mx = Math.max(...M.bars.map(b => b[0])) || 1, gap = M.bars.length > 20 ? 3 : 8, bw = (W - gap * (M.bars.length - 1)) / M.bars.length;
    chart = el('div', { width: W, height: H, alignItems: 'flex-end' }, ...M.bars.map((b, i) => el('div', { width: Math.max(2, Math.floor(bw)), marginRight: i === M.bars.length - 1 ? 0 : gap, height: Math.max(3, Math.round(b[0] / mx * H)), backgroundColor: b[1] })));
  }

  const allText = [t.tag, t.sub, M.label.toUpperCase(), M.value, M.sub || '', at, t.site, '$QOGE', '0123456789'].join('');
  const fonts = [];
  try {
    const [black, bold, num, mono] = await Promise.all([font('Inter:wght@900', allText), font('Inter:wght@700', allText), font('Unbounded:wght@700', allText), font('IBM+Plex+Mono:wght@500', allText)]);
    fonts.push({ name: 'Inter', data: black, weight: 900, style: 'normal' }, { name: 'Inter', data: bold, weight: 700, style: 'normal' },
      { name: 'Num', data: num, weight: 700, style: 'normal' }, { name: 'Mono', data: mono, weight: 500, style: 'normal' });
  } catch (e) {}

  const tree = el('div', { width: 1200, height: 675, position: 'relative', backgroundColor: BG, color: PAPER, fontFamily: 'Inter', flexDirection: 'column', padding: '44px 64px 0 64px' },
    el('div', { position: 'absolute', left: 0, top: 0, width: 14, height: 675, backgroundColor: RED }),
    el('div', { alignItems: 'center' },
      el('div', { backgroundColor: RED, color: '#ffffff', padding: '6px 16px', fontSize: 22, fontWeight: 900 }, t.tag),
      el('div', { marginLeft: 20, fontFamily: 'Mono', fontSize: 19, color: MUTE }, t.sub)),
    el('div', { marginTop: 34, fontSize: lSize, fontWeight: 900, color: TXT2 }, M.label.toUpperCase()),
    el('div', { marginTop: 10, fontFamily: 'Num', fontSize: vSize, fontWeight: 700, color: M.color, lineHeight: 1.05 }, M.value),
    M.sub ? el('div', { marginTop: 14, fontSize: sSize, fontWeight: 700, color: M.subColor || TXT2 }, M.sub) : el('div', {}),
    el('div', { position: 'absolute', left: 64, bottom: 78, width: W }, chart || el('div', {})),
    el('div', { position: 'absolute', left: 64, right: 64, bottom: 28, justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Mono', fontSize: 20, color: MUTE },
      el('div', {}, t.site + ' · ' + at),
      el('div', { fontFamily: 'Inter', fontSize: 30, fontWeight: 900, color: RED }, '$QOGE')));

  try {
    const png = await new ImageResponse(tree, { width: 1200, height: 675, fonts: fonts.length ? fonts : undefined }).arrayBuffer();
    if (!png || !png.byteLength) throw new Error('empty image');
    return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600, s-maxage=1800' } });
  } catch (e) {
    if (q.has('debug')) return new Response('qcard render error: ' + (e && (e.stack || e.message) || e), { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    return Response.redirect(origin + '/assets/og.jpg', 302);
  }
}

export { metric, KEYS };
