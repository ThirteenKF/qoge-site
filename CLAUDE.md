# Notes for Claude — QOGE site

Context for picking this project up in a new chat.

## Project
- Landing page for the $QOGE memecoin (doge that colonized Mars).
- Repo: https://github.com/ThirteenKF/qoge-site (public, branch `main`)
- Live site: https://www.qoge.fun (Vercel; qoge.fun redirects to www). Domain bought at Masterhost
  (masterhost.ru, renews ~4190 RUB/yr, auto-renew OFF). qoge.net (GoDaddy) was cancelled.
  DNS: A @ 216.198.79.1, CNAME www d29ba9e3571f7c77.vercel-dns-017.com.
- Backup copy: https://thirteenkf.github.io/qoge-site/ (GitHub Pages via Actions workflow)
- Local folder on the owner's PC: `C:\Users\0x13kf\Desktop\QOGE SITE\qoge-site`
  (the parent `QOGE SITE` folder holds the original export — do not edit it)

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
- Languages: en, es, pt, ru, zh — dictionaries in dict() (each has `loc` and live
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
- NFT teaser banner (#nft, between the ticker strip and #daily): QOGE Mars Gum collection (100 rover cards,
  files in `QOGE SITE\nft\mars-gum`), image assets/mars-gum-pack.webp, texts ng* in every language.
  Links: Discord + x.com/QOGEofficial. Update when the mint goes live on BAZARR Launch.
- Roadmap phases auto-complete at 500/1000/2500/5000 holders; rocket tracker parts install at
  50/250/500/1000/2500/5000 holders (PART_AT in renderVals()).
- Mobile layout: `@media (max-width:767px)` block in index.html helmet styles.

## Links
- X: https://x.com/QOGEofficial
- Telegram: https://t.me/QOGEofficial
- Contract (Quai Network): 0x0048848cA70eA1560577B4725A84b23B6bC589e2
- Discord: https://discord.gg/eHVA8rJ2J (replaced the old Chart button)
- Quainance button (replaced DexScreener — it does not list Quai Network yet)
- Wallets in how-to-buy: Pelagus https://www.pelaguswallet.io/ , Blip https://blippay.me/

## How we work
- Claude cannot push to GitHub directly. Claude edits files in the local folder
  and writes the commit message to `tools/commit-message.txt`.
- The owner runs `tools/publish.bat` (asks for the SSH key passphrase) →
  commit + push → Pages redeploys in ~1 min.
- Keep `main` working; commit messages short, imperative, English.
