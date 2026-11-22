# Notes for Claude — QOGE site

Context for picking this project up in a new chat.

## Starting from another Claude account
Everything needed lives in this repo; nothing depends on a particular Claude account or chat.
1. Give Claude the project: in the Claude desktop app add the folder `C:\Users\0x13kf\Desktop\qoge-site-main`
   (or let it read the public repo https://github.com/ThirteenKF/qoge-site).
2. Claude reads this file first, then the guide for the task:
   - QUAI Live dashboard → `tools/quai-dashboard.md` (sources, formulas, Redis history, design and EN/RU rules, backlog);
   - QNN Weekly digest → `tools/qnn-weekly.md`.
3. Secrets (Vercel env: Discord/Telegram tokens, Upstash Redis, DIGEST_SECRET) are only in Vercel, never in the repo;
   the new account does not need them to edit the site.
4. Not transferable: chats and artifacts of the old account (e.g. the dashboard design canvas). The chosen design is
   written down in `tools/quai-dashboard.md`, so nothing is lost.
Owner speaks Russian (sometimes types Russian on an English layout); answer in Russian.

## Project
- Landing page for the $QOGE memecoin (doge that colonized Mars).
- Repo: https://github.com/ThirteenKF/qoge-site (public, branch `main`)
- Live site: https://www.qoge.fun (Vercel; qoge.fun redirects to www). Domain bought at Masterhost
  (masterhost.ru, renews ~4190 RUB/yr, auto-renew OFF). qoge.net (GoDaddy) was cancelled.
  DNS: A @ 216.198.79.1, CNAME www d29ba9e3571f7c77.vercel-dns-017.com.
- Backup copy: https://thirteenkf.github.io/qoge-site/ (GitHub Pages via Actions workflow)
- Local folder on the owner's PC: `C:\Users\0x13kf\Desktop\qoge-site-main`
  (restored from a zip on 2026-11-06: git init + fetch from GitHub; publish via tools/publish.bat works)

## Files
- `index.html` — all markup, styles and logic (EN/RU dictionary, FAQ, roadmap,
  ticker). Exported from a design tool. Only the "Breaking News" design is kept;
  the unused hero/section variants were removed. <head> has title, description,
  Open Graph / Twitter preview tags (image: assets/og.jpg, 1200x630).
- `support.js` — generated runtime, loads React from unpkg. Do not edit.
- `assets/` — mars-bg.webp, earth-bg.webp (backgrounds; the .png originals are
  no longer used), logo.jpg (also favicon), doge.gif, og.jpg (link preview).

## Live metrics
- Tokenomics cards (market cap, price, liquidity, holders) + 7-day price chart
  (renderChart(), hand-drawn SVG, hover tooltip) load `assets/metrics.js`
  (sets window.QOGE_METRICS; works from file://). `metrics.json` = same data.
- `scripts/fetch-metrics.mjs` refreshes it from the Quainance API every 30 min
  in `.github/workflows/pages.yml`. Quainance API has no CORS, so the browser
  can't call it directly.
- Languages: en, ru — dictionaries in dict() (each has `loc` and live
  headline templates lv*); picker in renderLang() (LANGS list); first visit picks
  the browser language, choice saved in localStorage 'qoge-lang'.
- News ticker: `assets/news.js` (window.QOGE_NEWS, 146 puppy headlines per language,
  same order in every list). renderTicker() shows 8 random ones per hour plus
  ● live headlines built from metrics (holders, 24h price change, volume, mcap).
  To add news: append to both arrays in news.js.
- Vercel: `api/metrics.js` is a serverless function (GET /api/metrics, edge-cached
  10 min) with the same JSON as metrics.json; the page fetches it when not on
  github.io and falls back to assets/metrics.js. `.vercelignore` hides tools/,
  scripts/, .github/, CLAUDE.md from the deployed site.
- Daily block (#daily, renderDaily()): ship's log entry of the day from `assets/journal.js`
  (window.QOGE_LOG, 365 entries per language = one year story, same order; day 1 = 2026-10-04, day 365 = liftoff), visit streak (7 ranks at 1/3/7/30/100/200/365 days) +
  ranks with original neon space-electronics SVG badges (badgeSvg(): beacon, chip, HUD, radar, satellite, station, liftoff; LCD day counter) + "Share progress on X": the post links to /m?d=&r=&s=&l=&p= (vercel.json rewrite -> api/share.js,
  a page with og/twitter tags) whose og:image is api/og.js (Edge, @vercel/og) — X shows the card with
  the log entry + badge automatically. Badges for the card: assets/badges/rank-0..6.png (static renders
  of badgeSvg()). package.json only lists @vercel/og for the functions; the site has no build step.
  "Download picture" link still makes the same card in the browser (makeShareCard(), canvas)., and "since your last visit" / last-24h deltas.
  No server: streak lives in localStorage 'qoge-visit'. To add log entries: append to every list.
- Page order (Nov 2026): hero → ticker → #legend → #mission → #buy → #tokenomics → #roadmap → #nft → #faq → #daily → community.
- Header research button: .q-res/.q-pill, ink block with yellow icon, no animation (red offset shadow on hover), text t.resBtn.
  "QUAI Live" nav item: .q-live, outlined ink box with a static red dot. Research hub Telegram button: plain yellow .btn.
- NFT teaser banner (#nft, between #roadmap and #faq): QOGE Mars Gum collection (100 rover cards,
  files in `QOGE SITE\nft\mars-gum`), image assets/mars-gum-pack.webp, texts ng* in every language.
  Mint is LIVE (holder whitelist, 99 QUAI, 1 per wallet): launchpad
  https://launchpad.bazarr.xyz/mint/0x003880cbfaeb5050edbb61dcc4f8fd226826f4d8 , trading on https://www.bazarr.xyz/ .
  Banner has "How to mint (holders only)" steps ngS1..ngS4 (buy $QOGE -> Discord #connect-wallet role ->
  /whitelist address -> owner adds the address on the launchpad manually -> mint). Buttons: ngMint, #buy, Discord, ngTrade.
- Roadmap phases auto-complete at 500/1000/2500/5000 holders; rocket tracker parts install at
  50/250/500/1000/2500/5000 holders (PART_AT in renderVals()).
- Discord whitelist bot: `api/discord.mjs` (Node function). Discord Interactions Endpoint URL =
  https://www.qoge.fun/api/discord. Slash commands /whitelist address, /whitelist-me, /wl-admin
  (status/export/close/open-next; export = CSV attachment). One Discord account = one wallet;
  QOGE Holder role required; Quai Cyprus-1 addresses only. Data in Upstash Redis (wl:users,
  wl:addrs, wl:role, wl:wave, wl:open). /api/discord?action=setup re-registers commands and finds
  the role (public, throttled). Secrets only in Vercel env vars, never in the repo.
- Giveaways (same bot): /giveaway start prize winners (Manage Server) posts an embed with a Join button
  (custom_id gw:<id>); only QOGE Holder can enter (Redis set gw:<id>:users); /giveaway draw picks random
  winners and re-checks the role via the bot token; /giveaway status. Channel #qoge-giveaway (holders read +
  react only).
- Research hub look (Nov 22, 2026): same as the QUAI dashboard — #050505 background with the animated Quai mesh (`assets/quai-bg.js`),
  dark header (#0d0d0d, red logo/buy button, mono crumb, red underline on the active language), cards #0d0d0d with 1px #232323 borders
  (red on hover), green Telegram button (#5bd16a). Yellow stays for brand accents (title, Read buttons, "New" label). research-bg.webp is no longer used.
- Research section (`research/`): static pages, no runtime. `research/index.html` = hub (cards, one per
  report); `research/quai/index.html` = QUAI tokenomics report: slides as webp images (`en/NN.webp`,
  `ru/NN.webp`, 1600x900) + speaker notes, EN/RU toggle (shares localStorage 'qoge-lang', `?lang=ru` works),
  PDF downloads, og.jpg preview. Generated from the Claude Slides decks by a script in Claude's workspace.
  New report = new folder `research/<project>/` + a card in the hub. Main page links it via nav5 + footer.
- INJ report v2 "The Leaky Bucket / Дырявое ведро" (research/inj/, Nov 9, 2026): 30 slides EN+RU, both PDFs.
  Key facts: on-chain supply 122.9M INJ (not 100M), issuance ~5.4M/yr vs ~0.35M burned, INJC ETF live since Nov 5.
  Slides were rendered by a script in Claude's workspace (not in the repo); edit = re-render all 60 webp + PDFs.
- QUAI Live dashboard — FULL GUIDE: `tools/quai-dashboard.md`. Summary:
  QUAI Live dashboard (`research/quai-live/index.html`, Nov 21, 2026): independent live page — pulse (price, mcap,
  net inflation), supply (mined vs SOAP burned, 30 d), SOAP audit (team revenue vs on-chain burns valued at the
  burn-day price, transfers from the SOAP wallet that were not burned, gas-burner wallet), liquidity (±2% depth,
  price impact of $500/$5000), ecosystem (Hashference, x402, HashferenceStaking). EN/RU via 'qoge-lang'.
  Data: `api/quai.js` (Vercel function, GET /api/quai, edge-cached 1 h, maxDuration 60 in vercel.json) pulls
  CoinGecko, Quaiscan API, soap.qu.ai/api, supply.qu.ai/api, hashference.com/v1/stats, x402.qu.ai/v1/stats —
  none of the team APIs allow CORS. Each source fails independently; the page then uses that section from the
  snapshot `assets/quai-dash.js` (window.QUAI_DASH, same JSON) and the status line says "Snapshot".
  Key addresses: burn 0x0050AF…0000, SOAP wallet 0x0053bcdc…8D06, gas burner 0x004b00d6…Db93,
  staking 0x0009ac4b…896a. Quaiscan answers Vercel with 403, so burns/wallets/network fall back to the official explorer API
  (explorer.qu.ai/api: /address/<a>/transactions?limit=100&cursor=, /address/<a>, /stats/overview).
  Look: strict black/red (variant A from the design canvas): #050505 bg, #0d0d0d panels, #e3262b accent, semantic accents only: blue #2e97ca = inflow (SOAP revenue, mined),
  yellow #d6b42a = unlocks / warnings, green #5bd16a = good status / positive change, red = burns / risk / negative; fonts Unbounded (headings/numbers), Bai Jamjuree (text), JetBrains Mono (labels). No background image. Genesis unlocks: UNLOCKS constant in api/quai.js, copied from supply.qu.ai's JS bundle
  (GENESIS_UNLOCK_SCHEDULE; month m unlocks at block m*518400) — update it if the team changes the schedule. SOURCES in api/quai.js are plain JS, so the snapshot can be rebuilt by running them
  in a browser on each source's own origin. Card in the research hub before the QUAI report.
  Liquidity also has an on-chain row "Quainance DEX" (source `dex` in api/quai.js): QUAI/USDT pair 0x0021f5cc…2e83
  (token0 USDT 6 dec, token1 WQUAI) reserves via POST rpc.quai.network/cyprus1 quai_call getReserves (0x0902f1ac);
  impact by x*y=k with 0.3% fee; all-pool TVL + swap volume from api.llama.fi (/tvl/quainance, /summary/dexs/quainance);
  DEX share = Quainance 24h volume / (CoinGecko volume + it).
  History section (#hist): assets/quai-hist.js (window.QUAI_HIST_BASE) = backfill Jan 17 – Nov 20, 2026 of rolling-30-day
  buyback coverage (burns / (mined + max(0, other supply growth)), supply.qu.ai) and SOAP revenue (soap.qu.ai daily);
  newer days come from Redis hash quai:hist (one JSON per UTC day: p, mc, v, du, dd, dx, dxv, tvl, cov, b30, sup, lk, r30, lu,
  bs, hf, x4, tx), written by api/quai.js on every run (same KV_REST_API_* env as the bots) and returned as data.history.
  Daily Vercel cron in vercel.json hits /api/quai?save=1 at 23:50 UTC so every day gets a record. Depth and pool charts
  show a "recording since" note until 3 days exist.
  Header link: nav item "QUAI Live" (t.navLive, .q-live) after Q&A in index.html. Layout is fluid: .wrap up to 1760px, grids auto-fit, .duo pairs panels side by side from ~1300px.
- Deploy check: if the live site does not change ~2 min after a push, look at Vercel deployments
  (GitHub API /repos/ThirteenKF/qoge-site/deployments?environment=Production). On Nov 9 Vercel skipped one push;
  a new push re-triggered it. Images written by the device bridge carry a C2PA chunk (+~5.7KB) — harmless.
- Mobile layout: `@media (max-width:767px)` block in index.html helmet styles.

## Links
- X: https://x.com/QOGEofficial
- Telegram: https://t.me/QOGEofficial
- Contract (Quai Network): 0x0048848cA70eA1560577B4725A84b23B6bC589e2
- Discord: https://discord.gg/YgM6HKaQzG (permanent invite, never expires; replaced the old Chart button)
- Quainance button (replaced DexScreener — it does not list Quai Network yet)
- Wallets in how-to-buy: Pelagus https://www.pelaguswallet.io/ , Blip https://blippay.me/

## How we work
- Claude cannot push to GitHub directly. Claude edits files in the local folder
  and writes the commit message to `tools/commit-message.txt`.
- The owner runs `tools/publish.bat` (asks for the SSH key passphrase) →
  commit + push → Pages redeploys in ~1 min.
- Keep `main` working; commit messages short, imperative, English.

## Weekly digest (QNN Weekly, Telegram)
- FULL INSTRUCTIONS: `tools/qnn-weekly.md` (single source of truth; public raw URL
  https://raw.githubusercontent.com/ThirteenKF/qoge-site/main/tools/qnn-weekly.md — any Claude account can follow it).
- Every Monday ~9:40 Europe/Samara a scheduled Claude task prepares the RU digest + EN X thread and sends them
  to the owner; the owner pastes the text to the bot -> draft with "Опубликовать" -> channel.
- Structure: Главное (3, up to 5) + $QOGE line -> Цифра недели -> Мир -> Watchlist -> Слух недели (verdict +
  last week's rumor) -> Ещё за неделю -> $QOGE/Quai -> Календарь -> one CTA (rotation). <= 3900 chars.
- Watchlist: QUAI, INJ, STRK, NEAR, QRL/QTC, AVAX, ICP, ALGO, ZEC, LINK, DASH, ATOM, KSM, DOT, LTC.
- Memory: every published digest is archived by api/telegram.mjs (Redis tg:issues, numbered from the
  "QNN Weekly #N" first line). Public: GET /api/telegram?action=issues&limit=N (JSON) and /weekly, /weekly/N
  (api/weekly.mjs, rewrites in vercel.json).
- Direct delivery: POST /api/telegram?action=draft (DIGEST_SECRET) -> owner approves in a private chat.
- Optional cover image: add "image" (https URL, e.g. /assets/xxx.png on the site)
  and "title" (short caption shown on the photo) to the draft JSON. Published as
  photo + text pair; the image survives text corrections from the owner.
