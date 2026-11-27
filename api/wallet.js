// Vercel Edge Function: public balances of one Quai address for the "Check your wallet" block on the home page.
// GET /api/wallet?a=0x…  → QUAI (explorer, backup: RPC), $QOGE and Mars Gum NFTs (contract calls), other tokens (explorer).
// Public on-chain data only; nothing is stored or logged.
export const config = { runtime: 'edge' };

const RPC = 'https://rpc.quai.network/cyprus1';
const EXP = 'https://explorer.qu.ai/api';
const QOGE = '0x0048848ca70ea1560577b4725a84b23b6bc589e2';
const GUM = '0x003880cbfaeb5050edbb61dcc4f8fd226826f4d8';   // QOGE Mars Gum (ERC-721)
const json = (o, status = 200, cache = 'public, max-age=30, s-maxage=60') =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache } });

async function get(url, ms = 8000) {
  const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'qoge-site-wallet/1.0 (+https://www.qoge.fun)' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(url.replace(/\?.*/, '') + ' -> HTTP ' + r.status);
  return r.json();
}
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(method + ': ' + (j.error.message || 'error'));
  return j.result;
}
const call = (to, data) => rpc('quai_call', [{ to, data }, 'latest']);
const pad = a => a.slice(2).toLowerCase().padStart(64, '0');
// wei string (may be "4.07e+21" from the explorer) or hex -> number of whole coins
function coins(v, dec = 18) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && v.startsWith('0x')) v = BigInt(v).toString();
  const s = String(v);
  if (/e/i.test(s)) return Number(s) / 10 ** dec;
  const b = BigInt(s.split('.')[0]), d = 10n ** BigInt(dec);
  return Number(b / d) + Number(b % d) / Number(d);
}

export default async function handler(req) {
  const a = (new URL(req.url).searchParams.get('a') || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) return json({ error: 'bad_address' }, 400, 'no-store');
  const out = { address: a, updatedAt: new Date().toISOString(), errors: [] };
  const err = (k, e) => out.errors.push(k + ': ' + String(e && e.message || e).slice(0, 120));

  await Promise.all([
    // QUAI: explorer (also tx count, first seen), backup: node balance
    (async () => {
      try {
        const j = await get(`${EXP}/address/${a}?includeTransactions=false`), i = j.info || {};
        out.quai = coins(i.balance_quai) ?? 0; out.quaiLocked = coins(i.locked_balance_quai) || 0;
        out.qi = i.balance_qi != null ? Number(i.balance_qi) / 1000 : null;   // Qi has 3 decimals
        out.txCount = Number(j.txCount ?? i.tx_count) || 0; out.firstSeen = i.first_seen || null; out.label = i.label || null;
      } catch (e) {
        err('explorer', e);
        try { out.quai = coins(await rpc('quai_getBalance', [a, 'latest'])); out.quaiFrom = 'rpc'; } catch (e2) { err('rpc', e2); }
      }
    })(),
    // $QOGE: balanceOf on the token contract
    (async () => { try { out.qoge = coins(await call(QOGE, '0x70a08231' + pad(a))); } catch (e) { err('qoge', e); } })(),
    // Mars Gum: balanceOf on the NFT contract
    (async () => { try { out.marsGum = Number(BigInt(await call(GUM, '0x70a08231' + pad(a)))); } catch (e) { err('marsGum', e); } })(),
    // every other token the explorer knows for this address
    (async () => {
      try {
        const j = await get(`${EXP}/address/${a}/token-balances?limit=25`);
        out.tokens = (j.items || []).filter(x => x.token && x.token_address !== QOGE && x.token_address !== GUM).map(x => ({
          symbol: x.token.symbol || '?', name: x.token.name || '', type: x.token.type || '',
          balance: x.token.type === 'ERC721' ? Number(x.balance) : coins(x.balance, x.token.decimals ?? 18),
        })).filter(x => x.balance > 0).slice(0, 12);
      } catch (e) { err('tokens', e); out.tokens = null; }
    })(),
  ]);
  // QOGE from the explorer when the contract call failed
  if (out.qoge == null) {
    try { const j = await get(`${EXP}/address/${a}/token-balances?limit=50`), q = (j.items || []).find(x => x.token_address === QOGE); out.qoge = q ? coins(q.balance, 18) : 0; out.qogeFrom = 'explorer'; }
    catch (e) { err('qoge-explorer', e); }
  }
  if (out.quai == null && out.qoge == null) return json({ error: 'sources_down', errors: out.errors }, 502, 'no-store');
  return json(out);
}
