// Vercel Serverless Function: tokenomics watch for the QUAI Live dashboard.
//
//   GET /api/quai-watch          -> current warning state for the dashboard banner (edge-cached 5 min).
//   GET /api/quai-watch?run=1    -> run the checks (called every 30 min by scripts/fetch-metrics.mjs (GitHub Actions) and daily by
//                                   the Vercel cron; throttled to once per 20 min, so calling it by hand is harmless).
//
// Two independent watchers:
//   news  - qu.ai blog (sitemap), tokenomics pages of docs.qu.ai, go-quai releases on GitHub. Only items about forks,
//           unlocks, burns, supply or emissions count. The first run of each source only remembers what is there.
//   chain - the passport check from api/_tokenomics.js (chainCheck) on the live supply data from /api/quai.
// A new finding becomes an event in Redis and a Telegram message to the owner with two buttons
// ("important" / "false alarm", handled in api/telegram.mjs). The dashboard shows a banner while an event is open.
// Events found before the passport's UPDATED_AT count as handled, so updating the passport clears the banner.
// Nothing here changes any dashboard number: the worst a wrong finding can do is show a warning.
const TK = require('./_tokenomics.js');

const R_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function redis(...cmd) {
  if (!R_URL || !R_TOKEN) throw new Error('Redis is not configured');
  const r = await fetch(R_URL, { method: 'POST', headers: { authorization: 'Bearer ' + R_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(8000) });
  const j = await r.json(); if (j.error) throw new Error('redis: ' + j.error); return j.result;
}
const EVENTS = 'quai:tk:events', FP = s => 'quai:tk:fp:' + s, LOCK = 'quai:tk:lock';

async function get(url, json) {
  const r = await fetch(url, { headers: { 'user-agent': 'qoge-site-watch/1.0 (+https://www.qoge.fun/research/quai-live/)', accept: json ? 'application/vnd.github+json, application/json' : '*/*' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(url.replace(/\?.*/, '') + ' -> HTTP ' + r.status);
  return json ? r.json() : r.text();
}
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
const KW = /fork|tokenomic|unlock|vest|genesis|burn|supply|emission|inflation|halving|soap|monetary|reward|issuance/i;

// ---------- news sources: each returns { fp, found(prevFp) -> [event] } ----------
const NEWS = {
  async blog() {
    const xml = await get('https://qu.ai/sitemap.xml'), map = {};
    for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = (m[1].match(/<loc>\s*([^<]+?)\s*<\/loc>/) || [])[1] || '', mod = (m[1].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/) || [])[1] || '';
      const slug = (loc.match(/\/blog\/([^/?#]+)\/?$/) || [])[1];
      if (slug && !/^(authors|categories)$/.test(slug)) map[slug] = mod;
    }
    if (Object.keys(map).length < 20) throw new Error('sitemap: only ' + Object.keys(map).length + ' blog posts, layout changed?');
    return { fp: JSON.stringify(map), found(prev) {
      const old = JSON.parse(prev || '{}'), out = [];
      for (const [slug, mod] of Object.entries(map)) {
        const isNew = !(slug in old), changed = !isNew && old[slug] !== mod;
        if (!(isNew || changed) || !KW.test(slug)) continue;
        const title = slug.replace(/-/g, ' ');
        out.push({ id: 'blog-' + hash(slug + mod), src: 'blog', level: 'yellow', url: 'https://qu.ai/blog/' + slug,
          ru: (isNew ? 'Новая статья в блоге Quai' : 'Обновлена статья в блоге Quai') + ': «' + title + '»', en: (isNew ? 'New post on the Quai blog' : 'Quai blog post updated') + ': "' + title + '"' });
      }
      return out;
    } };
  },
  async docs() {
    const pages = ['tokenomics-overview', 'quai-emissions', 'protocol-upgrades'].map(p => 'https://docs.qu.ai/learn/tokenomics/' + p + '.md').concat('https://docs.qu.ai/learn/advanced-introduction/soap.md');
    const nums = {};
    await Promise.all(pages.map(async u => {
      const t = await get(u), set = new Set();
      for (const m of t.matchAll(/\b\d{1,3}(?:,\d{3}){2,}\b|\b\d{7,}\b/g)) set.add(m[0].replace(/,/g, ''));   // ≥ 1,000,000: supply-size numbers only
      nums[u] = [...set].sort();
    }));
    return { fp: JSON.stringify(nums), found(prev) {
      const old = JSON.parse(prev || '{}'), out = [];
      for (const [u, list] of Object.entries(nums)) {
        if (!old[u]) continue;                          // page added to the watch list: just remember it
        const was = new Set(old[u]), now = new Set(list), add = list.filter(x => !was.has(x)), gone = old[u].filter(x => !now.has(x));
        if (!add.length && !gone.length) continue;
        const f = a => a.slice(0, 4).map(x => Number(x).toLocaleString('en-US')).join(', ');
        out.push({ id: 'docs-' + hash(u + list.join()), src: 'docs', level: 'yellow', url: u.replace(/\.md$/, ''),
          ru: 'В документации Quai изменились цифры токеномики (' + u.split('/').pop().replace('.md', '') + ')' + (add.length ? ': новые ' + f(add) : '') + (gone.length ? (add.length ? '; ' : ': ') + 'убраны ' + f(gone) : ''),
          en: 'Tokenomics numbers changed in the Quai docs (' + u.split('/').pop().replace('.md', '') + ')' + (add.length ? ': new ' + f(add) : '') + (gone.length ? (add.length ? '; ' : ': ') + 'removed ' + f(gone) : '') });
      }
      return out;
    } };
  },
  async releases() {
    const list = await get('https://api.github.com/repos/dominant-strategies/go-quai/releases?per_page=10', true);
    if (!Array.isArray(list)) throw new Error('github: unexpected answer');
    const tags = list.map(r => r.tag_name);
    return { fp: JSON.stringify(tags), found(prev) {
      const old = new Set(JSON.parse(prev || '[]'));
      return list.filter(r => !old.has(r.tag_name) && KW.test((r.name || '') + ' ' + (r.body || ''))).map(r => ({
        id: 'rel-' + hash(r.tag_name), src: 'releases', level: 'yellow', url: r.html_url,
        ru: 'Новая версия ноды go-quai ' + r.tag_name + ' упоминает форк или токеномику', en: 'New go-quai node release ' + r.tag_name + ' mentions a fork or tokenomics' }));
    } };
  },
};

async function notify(ev) {
  const token = process.env.TELEGRAM_BOT_TOKEN, owner = process.env.TELEGRAM_OWNER_ID;
  if (!token || !owner) return 'telegram not configured';
  const head = ev.level === 'red' ? '🚨 Токеномика QUAI: данные блокчейна не сходятся с паспортом' : '⚠️ Токеномика QUAI: возможное изменение';
  const text = head + '\n\n' + ev.ru + (ev.url ? '\n' + ev.url : '') +
    '\n\nНа дашборде уже висит предупреждение. Если это важно — напиши Claude: «обнови паспорт токеномики дашборда», он сверит цифры и пересчитает дашборд. Если нет — нажми «Ложная тревога», предупреждение исчезнет.' +
    '\nhttps://www.qoge.fun/research/quai-live/';
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ chat_id: owner, text, link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: '❗ Это важно', callback_data: 'tk:ok:' + ev.id }, { text: '✖ Ложная тревога', callback_data: 'tk:no:' + ev.id }]] } }) });
  return r.ok ? 'sent' : 'telegram HTTP ' + r.status;
}

async function run(origin) {
  const report = { sources: {}, added: [] }, now = new Date().toISOString();
  const add = async ev => {
    const prev = await redis('HGET', EVENTS, ev.id);
    if (prev) {
      const p = JSON.parse(prev);
      // a chain finding that is still true after the passport was updated is raised again; dismissed ones stay quiet
      if (!(ev.src === 'chain' && p.status !== 'dismissed' && p.at < TK.UPDATED_AT)) return;
    }
    const e = { ...ev, at: now, status: 'new' };
    try { e.notified = await notify(e); } catch (x) { e.notified = String(x.message || x); }
    await redis('HSET', EVENTS, ev.id, JSON.stringify(e));
    report.added.push(ev.id);
  };
  for (const [name, f] of Object.entries(NEWS)) {
    try {
      const s = await f(), prev = await redis('GET', FP(name));
      if (prev != null) for (const ev of s.found(prev)) await add(ev);
      await redis('SET', FP(name), s.fp);
      report.sources[name] = prev == null ? 'baseline saved' : 'ok';
    } catch (e) { report.sources[name] = 'error: ' + String(e.message || e).slice(0, 160); }
  }
  try {
    const d = await get(origin + '/api/quai', true), issues = d.tokenomics?.issues || TK.chainCheck(d.supply);
    for (const i of issues) await add({ id: 'chain-' + i.id, src: 'chain', level: i.level, ru: i.ru, en: i.en, day: i.day });
    report.sources.chain = d.supply ? 'ok, ' + issues.length + ' finding(s)' : 'no supply data';
  } catch (e) { report.sources.chain = 'error: ' + String(e.message || e).slice(0, 160); }
  return report;
}

// open events for the banner: not dismissed, found after the last passport update; news fades after 14 days unless confirmed
async function state() {
  const out = { passport: { version: TK.VERSION, updatedAt: TK.UPDATED_AT }, affects: TK.AFFECTS, events: [] };
  const all = await redis('HGETALL', EVENTS) || [], cut = Date.now() - 14 * 864e5;
  for (let i = 1; i < all.length; i += 2) {
    let e; try { e = JSON.parse(all[i]); } catch (x) { continue; }
    if (e.status === 'dismissed' || e.at < TK.UPDATED_AT) continue;
    if (e.status !== 'confirmed' && e.level !== 'red' && Date.parse(e.at) < cut) continue;
    out.events.push({ id: e.id, src: e.src, level: e.status === 'confirmed' ? 'red' : e.level, ru: e.ru, en: e.en, url: e.url || null, at: e.at, confirmed: e.status === 'confirmed' });
  }
  out.events.sort((a, b) => (b.level === 'red') - (a.level === 'red') || (b.at > a.at ? 1 : -1));
  out.level = out.events.length ? out.events[0].level : null;
  return out;
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'https://' + (req.headers.host || 'www.qoge.fun'));
  try {
    if (url.searchParams.get('run') === '1') {
      const lock = await redis('SET', LOCK, '1', 'NX', 'EX', '1200');
      const origin = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'www.qoge.fun');
      const report = lock ? await run(origin) : { skipped: 'ran less than 20 min ago' };
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ...report, state: await state() });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.status(200).json(await state());
  } catch (e) {
    // the dashboard treats any failure as "no warning", so a broken watcher never breaks the page
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ passport: { version: TK.VERSION, updatedAt: TK.UPDATED_AT }, events: [], level: null, error: String(e.message || e).slice(0, 200) });
  }
};
module.exports.NEWS = NEWS;
module.exports.run = run;
module.exports.state = state;
