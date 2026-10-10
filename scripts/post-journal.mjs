// Posts today's ship's log entry (assets/journal.js) to X once a day.
// Runs in GitHub Actions (.github/workflows/x-daily.yml) with OAuth 1.0a
// user-context secrets — X API v2 free tier allows this volume easily.
// Day counter matches the site (and QogeStreak): day 1 = 2026-10-04 UTC.
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';

const LANG = process.env.POST_LANG || 'en';
const GENESIS_DAY = 20730; // 2026-10-04 UTC — keep in sync with the site/contract
const SITE = 'https://www.qoge.fun';
// /m renders the OG card with this exact log day + badge (api/share.js + api/og.js)
const cardUrl = (day) => `${SITE}/m?d=${day}&r=0&s=1&l=${LANG}&p=0`;

// assets/journal.js -> { en: [...], ru: [...], ... } (keys are bare, entries are JSON strings)
async function loadLog() {
  const txt = await readFile(new URL('../assets/journal.js', import.meta.url), 'utf8');
  const body = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)
    .replace(/^(\s*)(\w+):\s*\[/gm, '$1"$2": [');
  return JSON.parse(body);
}

const today = Math.floor(Date.now() / 864e5) - GENESIS_DAY + 1;
const log = await loadLog();
const list = log[LANG] || log.en;
const entry = list[(today - 1) % list.length];

if (!entry) throw new Error(`no journal entry for day ${today}`);

// ru/zh posts link to the localized card as well ($QOGE = X cashtag)
const text = `${entry}\n\nDay ${today} of the mission 🚀 ${cardUrl(today)} $QOGE`;

const API_KEY = process.env.X_API_KEY;
const API_SECRET = process.env.X_API_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_SECRET = process.env.X_ACCESS_SECRET;

if (!API_KEY || !API_SECRET || !ACCESS_TOKEN || !ACCESS_SECRET) {
  console.log(`[dry-run] secrets not set — today would be:\n\n${text}`);
  process.exit(0);
}

// ---- OAuth 1.0a (HMAC-SHA1) for POST https://api.twitter.com/2/tweets ----
const oauth = {
  oauth_consumer_key: API_KEY,
  oauth_token: ACCESS_TOKEN,
  oauth_signature_method: 'HMAC-SHA1',
  oauth_timestamp: String(Math.floor(Date.now() / 1000)),
  oauth_nonce: crypto.randomBytes(16).toString('hex'),
  oauth_version: '1.0',
};
const url = 'https://api.twitter.com/2/tweets';
// POST body is JSON, so it contributes nothing to the signature base
const base = ['POST', encodeURIComponent(url),
  Object.entries(oauth).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')]
  .map(encodeURIComponent).join('&');
oauth.oauth_signature = crypto.createHmac('sha1',
  `${encodeURIComponent(API_SECRET)}&${encodeURIComponent(ACCESS_SECRET)}`).update(base).digest('base64');
const authHeader = 'OAuth ' + Object.entries(oauth)
  .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`).join(', ');

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: authHeader },
  body: JSON.stringify({ text }),
});
const out = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`X API ${res.status}:`, JSON.stringify(out));
  process.exit(1);
}
console.log(`posted day ${today}:`, JSON.stringify(out.data || out));
