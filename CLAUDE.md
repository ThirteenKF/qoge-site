# Notes for Claude — QOGE site

Context for picking this project up in a new chat.

## Project
- Landing page for the $QOGE memecoin (doge that colonized Mars).
- Repo: https://github.com/ThirteenKF/qoge-site (public, branch `main`)
- Live site: https://thirteenkf.github.io/qoge-site/ (GitHub Pages via Actions workflow)
- Local folder on the owner's PC: `C:\Users\0x13kf\Desktop\QOGE SITE\qoge-site`
  (the parent `QOGE SITE` folder holds the original export — do not edit it)

## Files
- `index.html` — all markup, styles and logic (EN/RU dictionary, FAQ, roadmap,
  ticker). Exported from a design tool; several hero/section variants live in
  one file, switched by `heroVariant` (default: "Breaking News").
- `support.js` — generated runtime, loads React from unpkg. Do not edit.
- `assets/` — mars-bg.png, earth-bg.png, logo.jpg, doge.gif.

## Live metrics
- Tokenomics cards (market cap, price, liquidity, holders) + 7-day price chart
  (renderChart(), hand-drawn SVG, hover tooltip) load `assets/metrics.js`
  (sets window.QOGE_METRICS; works from file://). `metrics.json` = same data.
- `scripts/fetch-metrics.mjs` refreshes it from the Quainance API every 30 min
  in `.github/workflows/pages.yml`. Quainance API has no CORS, so the browser
  can't call it directly.
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
