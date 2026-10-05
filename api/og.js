// Vercel Edge Function: share card PNG (1200x675) for X/Telegram link previews.
// GET /api/og?d=<log day>&r=<rank 0..6>&s=<streak>&l=<en|ru|es|pt|zh>&p=<rocket %>
// Draws today's ship's-log entry + the rank badge (assets/badges/rank-N.png).
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const T = {
  en: { tag: '● ON THE RADIO', sub: '$QOGE · GROUND CONTROL', title: "Ship's log", day: 'day {n}', sign: '— Q., stranded on Mars', days: '{n} days in a row', one: '1 day in a row', rocket: 'Rocket built: {p}%', ranks: ['Cadet', 'Mechanic', 'Pilot', 'Navigator', 'Commander', 'Admiral', 'Mars legend'] },
  ru: { tag: '● НА СВЯЗИ', sub: '$QOGE · ЦЕНТР УПРАВЛЕНИЯ', title: 'Бортовой журнал', day: 'день {n}', sign: '— Q., застрял на Марсе', days: '{n} дн. подряд', one: '1 дн. подряд', rocket: 'Ракета собрана: {p}%', ranks: ['Стажёр', 'Механик', 'Пилот', 'Штурман', 'Командир', 'Адмирал', 'Легенда Марса'] },
  es: { tag: '● EN LA RADIO', sub: '$QOGE · CENTRO DE CONTROL', title: 'Diario de a bordo', day: 'día {n}', sign: '— Q., atrapado en Marte', days: '{n} días seguidos', one: '1 día seguido', rocket: 'Cohete listo: {p}%', ranks: ['Cadete', 'Mecánico', 'Piloto', 'Navegante', 'Comandante', 'Almirante', 'Leyenda de Marte'] },
  pt: { tag: '● NO RÁDIO', sub: '$QOGE · CONTROLE DA MISSÃO', title: 'Diário de bordo', day: 'dia {n}', sign: '— Q., preso em Marte', days: '{n} dias seguidos', one: '1 dia seguido', rocket: 'Foguete pronto: {p}%', ranks: ['Cadete', 'Mecânico', 'Piloto', 'Navegador', 'Comandante', 'Almirante', 'Lenda de Marte'] },
  zh: { tag: '● 通讯中', sub: '$QOGE · 地面控制', title: '航行日志', day: '第 {n} 天', sign: '—— Q.，被困火星', days: '连续 {n} 天', one: '连续 1 天', rocket: '火箭完成度：{p}%', ranks: ['学员', '机械师', '飞行员', '领航员', '指挥官', '上将', '火星传奇'] },
};

const INK = '#141110', CREAM = '#f4f0ec', YEL = '#f5d33a', RED = '#e8473f', GREY = '#a59e97';
const int = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

// assets/journal.js -> { en: [...], ru: [...], ... } (keys are bare, entries are JSON strings)
async function loadLog(origin) {
  const txt = await (await fetch(origin + '/assets/journal.js')).text();
  const body = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1).replace(/^(\s*)(\w+):\s*\[/gm, '$1"$2": [');
  return JSON.parse(body);
}

// Google Fonts subset (only the glyphs we draw) as TTF — the pattern from Vercel's OG docs
async function font(family, text) {
  const css = await (await fetch('https://fonts.googleapis.com/css2?family=' + family + '&text=' + encodeURIComponent(text))).text();
  const m = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
  if (!m) throw new Error('font ' + family);
  return (await fetch(m[1])).arrayBuffer();
}

// Every element is an explicit flex box (satori requires it for anything with several children)
const el = (type, style, ...children) => {
  const props = { style: { display: 'flex', ...style } };
  if (children.length === 1) props.children = children[0]; else if (children.length > 1) props.children = children;
  return { type: type === 'span' ? 'div' : type, props };
};

export default async function handler(req) {
  const url = new URL(req.url), q = url.searchParams, origin = url.origin;
  const L = T[q.get('l')] ? q.get('l') : 'en', t = T[L];
  const day = int(q.get('d'), 1, 100000, 1), r = int(q.get('r'), 0, 6, 0), s = int(q.get('s'), 1, 100000, 1), p = int(q.get('p'), 0, 100, 0);
  let entry = '…';
  try { const log = await loadLog(origin); const list = log[L] || log.en; entry = list[(day - 1) % list.length]; } catch (e) {}
  const quote = '“' + entry + '”';
  const title = (t.title + ' · ').toUpperCase(), dayTxt = t.day.replace('{n}', day).toUpperCase();
  const rank = t.ranks[r].toUpperCase(), streak = (s === 1 ? t.one : t.days.replace('{n}', s)).toUpperCase(), rocket = t.rocket.replace('{p}', p);
  const logNo = 'LOG #' + String(day).padStart(3, '0');
  const cjk = L === 'zh';
  const qLen = quote.length * (cjk ? 1.9 : 1);
  const qSize = qLen <= 60 ? 46 : qLen <= 95 ? 40 : qLen <= 130 ? 35 : qLen <= 170 ? 31 : 27;
  const tSize = (title + dayTxt).length * (cjk ? 1.9 : 1) > 26 ? 46 : 56;
  const rSize = rank.length * (cjk ? 1.9 : 1) > 12 ? 34 : 44;

  const allText = [t.tag, t.sub, title, dayTxt, quote, t.sign, rank, streak, rocket, logNo, 'www.qoge.fun', '$QOGE'].join('');
  const fonts = []; let fontErr = '';
  try {
    const [bold, black, mono] = await Promise.all([font('Inter:wght@800', allText), font('Inter:wght@900', allText), font('IBM+Plex+Mono:wght@500', allText)]);
    fonts.push({ name: 'Inter', data: bold, weight: 800, style: 'normal' }, { name: 'Inter', data: black, weight: 900, style: 'normal' }, { name: 'Mono', data: mono, weight: 500, style: 'normal' });
    if (cjk) {
      const [sc8, sc9] = await Promise.all([font('Noto+Sans+SC:wght@800', allText), font('Noto+Sans+SC:wght@900', allText)]);
      fonts.push({ name: 'SC', data: sc8, weight: 800, style: 'normal' }, { name: 'SC', data: sc9, weight: 900, style: 'normal' });
    }
  } catch (e) { fontErr = String(e && e.message || e); }
  const SANS = cjk ? 'SC, Inter' : 'Inter', MONO = cjk ? 'Mono, SC' : 'Mono';

  const tree = el('div', { width: 1200, height: 675, display: 'flex', position: 'relative', backgroundColor: INK, fontFamily: SANS, color: CREAM },
    el('div', { position: 'absolute', left: 0, top: 0, width: 16, height: 675, backgroundColor: RED }),
    el('div', { position: 'absolute', left: 16, bottom: 0, width: 1184, height: 14, backgroundColor: YEL }),
    // left column
    el('div', { position: 'absolute', left: 64, top: 44, width: 720, display: 'flex', flexDirection: 'column' },
      el('div', { display: 'flex', alignItems: 'center' },
        el('div', { display: 'flex', backgroundColor: RED, color: CREAM, padding: '6px 16px', fontSize: 22, fontWeight: 900 }, t.tag),
        el('div', { display: 'flex', marginLeft: 20, fontFamily: MONO, fontSize: 18, color: GREY }, t.sub)),
      el('div', { display: 'flex', marginTop: 20, fontSize: tSize, fontWeight: 900 },
        el('span', { color: CREAM }, title), el('span', { color: YEL }, dayTxt)),
      el('div', { display: 'flex', flexDirection: 'column', marginTop: 22, width: 700, height: 380, backgroundColor: CREAM, border: '6px solid ' + INK, boxShadow: '12px 12px 0 ' + RED },
        el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 44, backgroundColor: INK, fontFamily: MONO, fontSize: 18, color: CREAM },
          el('div', { display: 'flex', alignItems: 'center', height: 44, padding: '0 18px', backgroundColor: RED }, logNo),
          el('div', { display: 'flex', paddingRight: 18 }, 'www.qoge.fun')),
        el('div', { display: 'flex', flexGrow: 1, padding: '24px 30px 0', fontSize: qSize, fontWeight: 800, lineHeight: 1.22, color: INK }, quote),
        el('div', { display: 'flex', padding: '0 30px 24px', fontFamily: MONO, fontSize: 20, color: '#6b635d' }, t.sign))),
    // right column: badge + rank
    el('div', { position: 'absolute', left: 830, top: 96, width: 320, display: 'flex', flexDirection: 'column', alignItems: 'center' },
      { type: 'img', props: { src: origin + '/assets/badges/rank-' + r + '.png', width: 300, height: 300 } },
      el('div', { display: 'flex', marginTop: 16, fontSize: rSize, fontWeight: 900, color: YEL, textAlign: 'center' }, rank),
      el('div', { display: 'flex', marginTop: 6, fontSize: 30, fontWeight: 900, color: CREAM }, streak),
      el('div', { display: 'flex', marginTop: 10, fontFamily: MONO, fontSize: 20, color: GREY }, rocket)),
    el('div', { position: 'absolute', left: 64, bottom: 38, display: 'flex', fontFamily: MONO, fontSize: 26, color: CREAM }, 'www.qoge.fun'),
    el('div', { position: 'absolute', right: 60, bottom: 36, display: 'flex', fontSize: 30, fontWeight: 900, color: YEL }, '$QOGE'));

  // Render fully before answering: a failed render would otherwise stream an empty PNG.
  try {
    const png = await new ImageResponse(tree, { width: 1200, height: 675, fonts: fonts.length ? fonts : undefined }).arrayBuffer();
    if (!png || !png.byteLength) throw new Error('empty image');
    return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400, s-maxage=31536000, immutable' } });
  } catch (e) {
    if (q.has('debug')) {
      return new Response('og render error: ' + (e && (e.stack || e.message) || e) + '\nfonts loaded: ' + fonts.map(f => f.name + ' ' + f.weight + ' ' + f.data.byteLength).join(', ') + '\nfont error: ' + fontErr + '\nentry: ' + entry,
        { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    return Response.redirect(origin + '/assets/og.jpg', 302); // fallback: the regular site preview
  }
}
