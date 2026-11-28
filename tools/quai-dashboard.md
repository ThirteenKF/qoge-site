# QUAI Live dashboard — full guide for Claude

Single source of truth for `research/quai-live/` (https://www.qoge.fun/research/quai-live/).
Any Claude account can pick the work up from this file plus `CLAUDE.md`.
Public raw URL: https://raw.githubusercontent.com/ThirteenKF/qoge-site/main/tools/quai-dashboard.md

## What it is
An independent, unofficial dashboard that puts all public Quai Network data in one place and audits
the SOAP buyback (what the team says it earned vs what was really burned on-chain). EN/RU.
Not affiliated with the Quai team; no financial advice. Built Nov 2026.

Sections, top to bottom: hero + status line → "Key takeaways, last 30 days" (event strip + 4 verdict cards) →
Pulse (dynamic tiles with sparklines, 120-day price chart with unlock/burn markers) → Hashference (own section, priority:
tiles, all-history requests chart from our archive, top models, apps & agents, mining shares per day, QUAI staked over time) → Supply (tiles, 30-day
waterfall + "Buyback coverage" card, mined vs burned per day, genesis unlocks) → SOAP audit (where the revenue went,
chain mix, monthly revenue vs burned, leaks table, latest burns, gas-burner note) → Liquidity (CEX impact/depth,
Quainance DEX pool row, exchanges table) → History (coverage + SOAP revenue backfilled; depth + DEX pool recorded
daily) → Ecosystem (Hashference, x402, staking, network) → Method and sources.

## Files
| File | Role |
|---|---|
| `research/quai-live/index.html` | The page: markup, CSS, EN/RU dictionary `T`, all rendering (hand-made SVG charts, no libraries). |
| `api/quai.js` | Vercel function `GET /api/quai`: pulls every source, derives numbers (`assemble()`), writes/reads daily history in Redis. Edge-cached 1 h. `maxDuration` 60 in `vercel.json`. |
| `assets/quai-dash.js` | Snapshot `window.QUAI_DASH` (same JSON as the API). The page uses it per section when a live source fails, and offline. |
| `assets/quai-hist.js` | `window.QUAI_HIST_BASE`: backfilled daily history (Jan 17 – Nov 20, 2026) of buyback coverage and SOAP revenue. |
| `scripts/quai-backfill.js` | Browser snippets that rebuild `quai-hist.js` from the team APIs. |
| `vercel.json` | `crons`: `/api/quai?save=1` daily at 23:50 UTC so every day gets a history record. |
| `research/index.html` | Hub card for the dashboard. `index.html` header has the "QUAI Live" nav item (`t.navLive`, `.q-live`). |

## Data sources (all fetched server-side: none of the team APIs allow CORS)
- **Exchange order books (free, no key)** — source `books`: MEXC `api.mexc.com/api/v3/depth?symbol=QUAIUSDT` + `/ticker/24hr`,
  Gate `api.gateio.ws/api/v4/spot/order_book?currency_pair=QUAI_USDT` + `/spot/tickers`, Kraken `api.kraken.com/0/public/Depth?pair=QUAIUSD` + `/Ticker`.
  ±2% depth = USD resting within 2% of the mid. A book whose mid is >15% from the median is dropped (Kraken showed $0.0091 vs $0.0068 on Nov 22).
  Live books replace CoinGecko's copy for the same exchange; CoinGecko keeps the others (BitKan).
- **CoinGecko** (no key, public rate limit): `/coins/quai-network` (price, mcap, volume, ATH/ATL), `/tickers?depth=true` (optional), `market_chart` (daily closes).
  Last good `market` and `prices` are cached in Redis (`quai:cache:market`, `quai:cache:prices`, used up to 3 days). If CoinGecko and the cache are
  both missing, price = median of the books and mcap = price × circulating supply (`market.fromBooks`). Optional `COINGECKO_API_KEY` (free Demo key) still works.
- **SOAP dashboard** `https://soap.qu.ai/api`: `/revenues` (all-time by chain), `/revenues/daily?start=&end=` (unix seconds; returns totals for the range, not per day).
- **Supply tracker** `https://supply.qu.ai/api`: `/stats`, `/supply?period=day&from=&to=&include=burn` (quaiTotalEnd, burnDelta), `/rollups?period=day&from=&to=` (coinbaseQuaiMiningRewardSum = mined; also workshares per algorithm, difficulties, Qi conversion flow — unused yet). Big numbers come as `{__big:"…wei"}`.
- **Block explorers**: Quaiscan Blockscout `/api/v2` answers Vercel with HTTP 403, so burns/wallets/network fall back to the official explorer `https://explorer.qu.ai/api` (`/address/<a>/transactions?limit=100&cursor=`, `/address/<a>?includeTransactions=false`, `/stats/overview`). Explorer `value` can be scientific notation ("4e+24") → `toWeiString()`.
- **Hashference** `https://hashference.com/v1/stats?days=30`, `/v1/staking` (optional), `/v1/x402`; **x402** `https://x402.qu.ai/v1/stats?days=30`.
  PRIORITY SOURCE (the whole Quai community watches it). Requests = `demand.requests` / `demand.daily` = all RECEIVED requests,
  the same number as hashference.com/statistics ("Запросы на инференс … Received"). The top-level `summary`/`daily` count only
  requests with measured tokens and have gaps (Nov 22, 2026: 6 measured vs 543 received) — kept as `measured`/`measuredDaily`,
  `series` says which one is used ('received' | 'measured' | 'archive'). `updatedAt` from the source is passed through and shown
  in the Ecosystem tile. Week-over-week numbers (verdict card + Pulse tile) use the last 7 COMPLETE UTC days (`hfWeeks()` in the page);
  today's bar is drawn faded and is not counted.
  Own archive: Redis hash `quai:hf` (UTC day → requests), every finished day written on each run (`hashferenceArchive()`).
  A finished day the source later reports below 50% of the archived value keeps the archived value (`hashference.corrected`).
  If hashference.com is down and there is no Redis cache, the 30-day series is rebuilt from the archive (`series:'archive'`,
  shown in the status line as a backup copy).
  `/v1/stats?days=90` is fetched too (optional) only to seed the archive with older days; the API returns `hashference.history`
  (archive + today, up to 400 days) for the long chart. Also passed: `models`/`apps` ([name, requests, tokens, share of tokens], top 8,
  30 days), `netDaily` ([day, devices, shares, x402]), `devicesConnected`, `shares30`.
- **Quainance DEX**: QUAI/USDT pair `0x0021f5cc862ebb0252ba209266f2fabbc7592e83` (token0 USDT 6 decimals, token1 WQUAI 18). Reserves via `POST https://rpc.quai.network/cyprus1` method `quai_call`, data `0x0902f1ac` (getReserves). TVL and swap volume of all Quainance pools from DefiLlama `https://api.llama.fi/tvl/quainance` and `/summary/dexs/quainance`.
- Genesis unlock schedule: constant `UNLOCKS` in `api/quai.js`, copied from supply.qu.ai's JS bundle (GENESIS_UNLOCK_SCHEDULE after Singularity/Polaris; month m unlocks at block m×518400). Past dates: `UNLOCK_DATES`. Update by hand if the team changes the schedule.

## Backups when a source breaks
1. Own backups: CoinGecko market → CoinPaprika (`market.backup`), CoinGecko daily prices → Gate daily candles, Quaiscan → explorer.qu.ai,
   CoinGecko tickers ↔ exchange books (MEXC/Gate/Kraken), DefiLlama is optional inside `dex`.
2. Then the last good answer of every source from Redis (`quai:cache:<source>`, up to 7 days) — listed in `data.cached`
   and in the page status line ("из резервных копий: …").
3. Hashference only: our own day archive `quai:hf` (see Data sources).
4. In the browser: the last live answer this browser saw (localStorage `quai-last`, without history) if it is newer than the snapshot,
   then the static snapshot `assets/quai-dash.js`. Both show as "Snapshot · updated …" in the status line.
- Every request has a 12 s timeout and one retry on a network error, timeout or HTTP 5xx (`getJson`; the Quainance RPC call has the timeout too);
  HTTP 429 is retried twice with a pause.
- Order books: a CoinGecko ticker whose ±2% depth matches a live exchange book within 5% on both sides is dropped as a mirror
  (BitKan copies Gate's book; counting it doubled the depth).
The daily Telegram check reports every source running on a backup or cache.

## Key addresses
- Burn address `0x0050AF0000000000000000000000000000000000`
- SOAP wallet `0x0053bcdc4F5Af4B35079d4D091fCD1D86A958D06` (sends bought QUAI to the burn address)
- Gas burner `0x004b00d6339F5aae012145356c8D5C71AFa1Db93` (receives QUAI from SOAP, calls contract `0x00740BF8…` that only burns gas; counted as burned)
- HashferenceStaking `0x0009ac4b8c3357b7f3e7e2baeb07736f3f51896a`
- A second wallet `0x007e2f1a…8987` also sends ~5M QUAI burns (shown as "other wallet").

## Formulas (keep them; the texts on the page depend on them)
- **SOAP reconciliation (`recon`)**: revenue = SOAP API total. Burned USD = each burn's QUAI × CoinGecko close on the burn day (+ gas-burner transfers). "Sent to other wallets" (leaks) = SOAP-wallet transfers not to burn/gas burner, minus what the same recipient later burned or sent back. Untraced = revenue − burned − leaks (swap costs, timing, unknown).
- **Supply d30**: mined, burned, change over the last 30 days; `other = change − (mined − burned)`; `unlocked` = schedule months in the window; `otherRest = other − unlocked` (shown as "Qi→QUAI & other (residual)" — not measured directly).
- **Buyback coverage** = burned / (mined + unlocked + max(0, otherRest)) = burned / (mined + max(0, other)). Card also shows burned/day, needed/day for zero growth, SOAP revenue/day and "month without a big unlock" = burned / (mined + otherRest + next unlock/30) when the window holds an unlock >1.5× the next one.
- **Net inflation / yr** = (mined − burned)/30×365/supply. **Dilution 12 m** = that + unlocks in the next 12 months / supply.
- **CEX impact** (linear): 2 × order / depth(+2%) for one exchange (largest by volume) and for all exchanges.
- **DEX impact** (exact, x·y=k): buy X USDT, fee 0.3% → price × ((R+X·0.997)/R)²; ±2% depth = R·(√1.02−1) and R·(1−√0.98). DEX share = Quainance 24 h volume / (CoinGecko volume + it).

## History (Redis)
- Same Upstash database as the Discord/Telegram bots (`KV_REST_API_URL`/`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_*` in Vercel env; never in the repo).
- Hash `quai:hist`, field = UTC date, value = JSON `{p, mc, v, du, dd, dx, dxv, tvl, cov, b30, sup, lk, r30, lu, bs, hf, x4, tx}` (price, mcap, volume, depth up/down, DEX pool USD, DEX vol, Quainance TVL, coverage, burned 30 d, supply, locked, SOAP revenue 30 d, leaks USD, burn share, Hashference requests, x402 payments, tx today, `hst` QUAI in HashferenceStaking, `hdv` Hashference devices 7 d). Rewritten on every run; the last run of the day wins.
- The page joins `QUAI_HIST_BASE` (backfill) with `data.history` (days after `to`). Depth/pool charts show "recording since Nov 21" until 3 points exist.
- Lost or changed formula → rebuild the backfill with `scripts/quai-backfill.js`.

## Failure alerts (Telegram)
- On the daily cron run (`/api/quai?save=1`, user-agent `vercel-cron`) `health()` in `api/quai.js` lists broken sources
  (`<section>Error`) and stale data (supply.qu.ai last day older than 2 days, SOAP 7-day revenue 0, no CoinGecko price,
  Quainance pool under $1,000, Redis error) and Hashference problems (stats older than 6 h, no `demand` field, served from the archive,
  past days corrected from the archive, daily sum ≠ total by more than 3%). If the list is not empty, the QNN bot sends the owner ONE private message
  (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID` — same env as `api/telegram.mjs`). Silent when all is fine.
- The list is also returned publicly as `data.health`.
- Manual test: `https://www.qoge.fun/api/quai?save=1&test=1&key=<DIGEST_SECRET>` — always sends a message ("all sources work" if OK).
  Requests with `save=1` from anyone else never send anything.

## Snapshot refresh (`assets/quai-dash.js`)
Open https://www.qoge.fun/api/quai (or `fetch('/api/quai')` in a browser on qoge.fun), drop the `history` key, save as
`window.QUAI_DASH = {…};` with the comment line on top. Do it after adding a new section to the API so offline/fallback works.

## Design rules (owner's choices — keep)
- Strict black/red ("variant A"): bg `#050505`, panels `#0d0d0d`, borders `#232323`, accent red `#e3262b`.
  Semantic colors only where they mean something: blue `#2e97ca` = inflow (SOAP revenue, mined), yellow `#d6b42a` = unlocks/warnings,
  green `#5bd16a` = good status / positive change, red = burns / risk / negative. No background image, no animated/flowing buttons.
  Background: `assets/quai-bg.js` — a very dim animated canvas (grey node mesh, red hubs, small red "blocks" running along links), shared
  with the research hub; it pauses in hidden tabs and stays still with prefers-reduced-motion. Panels stay opaque (#0d0d0d) so charts read cleanly.
- Fonts: Unbounded (headings, numbers), Bai Jamjuree (text), JetBrains Mono (labels, table numbers).
- Fluid layout: `.wrap` up to 1760 px, grids auto-fit, `.duo` = two panels side by side from ~1300 px; must not overflow at 390 px.
- Charts are hand-drawn SVG (`lineChart`, `barChart`, sparklines) with hover tooltips; one axis per chart.

## EN/RU rules
- Every visible string lives in `T.en`/`T.ru` or in `data-en`/`data-ru` attributes; language shared with the site via localStorage `qoge-lang` (`?lang=ru` works).
- Russian numbers: decimal comma, "тыс." / "млн" / "млрд", minus "−" (not hyphen), non-breaking space inside "$5 000". All formatting goes through `usd()`, `num()`, `pct*()`, `sgn()`, `px()` and `dc()` — never call `toFixed()` straight into text.
- Write plainly: say what a number means and what it is compared with; when two numbers look contradictory (e.g. "99% of revenue burned" vs "50% coverage"), explain the difference next to them.

## How to check changes
- **Deep render test (run before every handover):** `python3 tools/quai-deep-test.py <repo folder>` — 4 data scenarios
  (live-like, partial sources, extreme values, API down) × EN/RU × widths 360–1920; reports page errors, text artifacts
  (undefined/NaN/null/".."), overflow, clipped or spilling text, empty blocks. Must print OK for all 56 runs.
- **Live cross-checks (`sanity()` in api/quai.js, part of `data.health` and the daily Telegram check):** CoinGecko vs Quainance price,
  mcap vs price × supply, SOAP revenue in the audit vs the source and vs the monthly sum, burned share ≤ 100%, coverage range,
  mined > 0, price history and Hashference data not older than 2 days, next unlock not in the past, today's history record exists.
- Counters that come back 0/null (explorer.qu.ai while it rebuilds headline metrics) are treated as missing, not as 0.
- Price backups: CoinGecko → CoinPaprika → `quaiPrice` from explorer.qu.ai `/stats/overview`.
- Render offline with Playwright: open `file:///…/research/quai-live/index.html`, abort all http(s) requests (page then uses the snapshot), set `localStorage['qoge-lang']` to `ru`/`en`, screenshot at 1440 and 390 px, check `document.documentElement.scrollWidth` equals the viewport width and there are no page errors.
- API logic: `node -e "require('./api/quai.js').assemble({...})"` with mocked parts; history with a mocked `fetch` for Redis.
  `hashferenceArchive`, `getJson` and `health` are exported for such tests (mock `global.fetch`, set KV_REST_API_URL/TOKEN before require).
- After the owner publishes: open the live page; the status line must say "Live data" / "Живые данные" with no sections from the snapshot.

## Workflow
Claude edits files in the owner's folder (`C:\Users\0x13kf\Desktop\qoge-site-main`, via the Claude desktop app with the folder connected),
writes `tools/commit-message.txt`, the owner runs `tools/publish.bat` → GitHub → Vercel deploys in ~1–2 min.
Do not touch the main page or other research pages unless asked; the owner usually wants work limited to the dashboard.

## Audit notes (Nov 22, 2026 — checked against the team's own dashboards)
- Matches soap.qu.ai exactly: total revenue $7,074,007.84, 30-day revenue, 254,599,025 QUAI burned (team shows it at today's price).
- Matches supply.qu.ai: circulating 1.163B, locked genesis 90.4M, genesis unlocked in 30 d 12.6M, mined in 30 d ≈29.1–29.4M (window differs).
- Team's "SOAP offset · 30d" = burned / mined only (~85%); ours "coverage" also counts unlocks and Qi→QUAI (~50%). The card shows both.
- Gas burner (17M QUAI, $191K): counted as burned on the ASSUMPTION that Quai destroys the base fee (headers carry baseFeePerGas).
  Not confirmed; the team does not count it. The page says so and gives the share without it (81%).
- "Sent elsewhere" destinations (explorer labels): 0x00091d… and 0x004dae… are Gate deposit addresses, 0x001771… → Kraken,
  0x007718… (4M, the largest) spread to ~26 addresses, a few still hold the coins. The team says SOAP purchases are burned OR
  routed to rewards for locked QUAI, so part of it may be that. `enrich()` in api/quai.js fills `leak.next` and burn `label`.
- 0x007e2f…8987 is Gate's hot wallet: its burns are SOAP purchases withdrawn from Gate straight to the burn address.
- Price note after unlocks = fixed 7-day change (an earlier version picked the lowest point in 7 days — biased, removed).
- CoinGecko sometimes answers Vercel with HTTP 429: getJson retries twice, books come straight from the exchanges, CoinGecko data is cached in Redis; the alert warns if the cache is older than a day.
  DEX share is not computed without CoinGecko volume. Unlock dates use the average block time of complete days (`blockTime30`).

## Facts established so far (Nov 21, 2026)
- SOAP all-time revenue ≈ $7.07M; burned ≈ $5.93M (84%); leaks ≈ $357K (mostly Jan–Feb 2026, the largest 4M QUAI to `0x007718…9baf`); untraced ≈ $787K. Last 30 days: ~99% of revenue burned.
- Revenue is falling: last 30 days ≈ $169K vs $396K the 30 days before; peak ≈ $1.48M/30 d in Feb 2026.
- Coverage ≈ 50% now; history: ~7% in Feb (181M unlock), peak ~92% in July.
- Net inflation from mining ≈ 4.3%/yr; with unlocks ≈ 8%/yr. 90.4M QUAI still locked; unlocks ~3.7M/month until ~Feb 2029.
- CEX depth within +2% ≈ $2.2K; Quainance QUAI/USDT pool ≈ $20K but only ~$100 within ±2% ($500 buy moves it ~10%); DEX ≈ 2–3% of QUAI trading.
- Hashference demand doubling week over week (≈10K requests/7 d); 62% of its credit comes from QUAI staking.

## Tokenomics passport and watch (Nov 27, 2026)
- `api/_tokenomics.js` = the passport: unlock schedule (UNLOCKS, UNLOCK_DATES, BLOCKS_PER_MONTH), FORKS (shown in the
  feed as "tokenomics"), AFFECTS (data-k keys of the numbers that depend on it: unlock, supply, cov), VERSION, UPDATED_AT.
  api/quai.js takes every tokenomics rule from here; nothing else hard-codes the schedule (the History chart's past
  unlock markers are facts, not rules).
- `chainCheck(supply)` (same file): per day, residual = supply change − mining + SOAP burns (noise ±0.2M/day). A scheduled
  unlock must show up as ≥50% of its size within −3…+4 days of its block (checked once the window is complete);
  a residual > max(1.5M, 10×robust σ) on a day without a scheduled unlock = coins the passport doesn't know about (red);
  a big unexplained drop = yellow. Output in /api/quai as `tokenomics.issues`.
- `api/quai-watch.js`: `?run=1` (every 30 min from scripts/fetch-metrics.mjs in GitHub Actions + Vercel cron 12:10 UTC, Redis lock 20 min)
  checks qu.ai/sitemap.xml (new/updated blog posts whose slug mentions fork/unlock/burn/supply/emission…), supply-size
  numbers (≥1,000,000) on docs.qu.ai tokenomics pages (overview, quai-emissions, protocol-upgrades, soap), go-quai GitHub
  releases mentioning a fork, and chainCheck. First run of a source = silent baseline. New finding → Redis hash
  `quai:tk:events` + Telegram to the owner with buttons «Это важно» (tk:ok → red) / «Ложная тревога» (tk:no → hidden),
  handled in api/telegram.mjs. Plain GET = banner state (edge 5 min); any error = no banner.
- Dashboard: `#tkBanner` under the header (yellow = possible change, red = confirmed / chain mismatch), ⚠ marks on the
  AFFECTS tiles and the Supply heading; X cards of those keys get a warning strip (api/qcard.js).
- **When the owner says "обнови паспорт токеномики"**: read the event (Telegram text / banner), check the official numbers
  (supply.qu.ai next unlock + table, docs.qu.ai quai-emissions, the blog post), update UNLOCKS/UNLOCK_DATES/FORKS in
  api/_tokenomics.js, set VERSION and UPDATED_AT = now (UTC) → every earlier event counts as handled, the banner goes.
  A chain finding that is still true after the update is raised again on the next run. Run the deep test.
- Deep test has scenarios warnYel / warnRed (banner + marks must appear) and checks that no banner shows otherwise.

## Whale moves (Nov 28, 2026)
- `api/quai-whales.js`: `?run=1` every 30 min from scripts/fetch-metrics.mjs (Redis lock 20 min); plain GET = last 30 days
  of moves + 7-day sums (edge 5 min, any error = section hidden).
- Watched: top 200 holders from Quaiscan `/api/v2/addresses` (sorted by balance) + exchange wallets EXCH (Gate 0x007e2f…,
  MEXC 0x006243…, Kraken 0x0075b7…, labels from the official explorer). Skipped: SOAP burn/wallet, WQUAI, Hashference
  staking, gas burner, unlabelled addresses with >200k txs (mining pool payouts). Quaiscan refused → re-read the last
  known whales one by one from explorer.qu.ai.
- Each run compares balances with the previous one (Redis `whale:bal`); only addresses that moved ≥ threshold get their
  latest txs read (Quaiscan, backup explorer). First run = silent baseline. Moves in Redis hash `whale:moves` (by tx hash,
  30 days), facts per address (label, first seen) in `whale:info`.
- Kinds: toEx (red), fromEx (green), exex (gray), move (yellow); `genesis` = sender first seen before 2025-02-08
  (network launch: foundation/team/investor allocations). The explorer has no vesting flag (locked_balance_quai = 0
  everywhere), so we say "address from the network launch", never "team".
- Thresholds from order-book depth ±2% (avg of depthUp/Down): section ≥ max($2k, 0.7×depth); feed ≥ max($5k, 2×depth)
  (≈ moves the price ~5%), a day with >2 of one kind → 2 lines + "и ещё N…"; Telegram to the owner ≥ max($20k, 4×feed).
- Wording rule: "ушло на Gate", "выведено с MEXC", never "кит продаёт".

## Backlog (ideas agreed with the owner, not built yet)
- Mining block: share of donor-chain blocks found by SOAP (≈2% of BCH, ≈0.3–0.4% LTC/DOGE, ≈30% RVN on a 5-day sample — recheck on 30 days), miners' daily pay in USD vs buyback per day, workshares by algorithm (rollups data).
- Alerts to Telegram/X on burns, upcoming unlocks, SOAP-wallet leaks, coverage drops (reuse `api/telegram.mjs` drafts).
- Share cards per metric (reuse `api/og.js`), a Quai block in QNN Weekly from `/api/quai`, "Tokens on Quai" table, public API docs / embeddable widget.

## Changes Nov 27, 2026
- Hashference switched to the received series (matches hashference.com/statistics), complete-day weekly comparison,
  own day archive + regression guard, health checks; source time shown in the Ecosystem tile.
- Page: glossary (12 terms, EN/RU), plain-words "Bottom line" sentence above the verdicts, "share of revenue burned" vs
  "new coins offset by burns" renamed so they cannot be confused, (i) tooltips open on tap on phones, month labels "Dec ’25".
- Network tile hides a zero address count (explorer returns `addresses: 0`).
- Hashference got its own section after Pulse (nav "Hashference"); the Ecosystem section keeps x402 and network tiles.
