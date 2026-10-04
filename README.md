# $QOGE — landing page

Live: https://www.qoge.net

Landing page for **$QOGE** — the very good boy who accidentally colonized Mars.

- X / Twitter: https://x.com/QOGEofficial
- Telegram: https://t.me/QOGEofficial
- Discord: https://discord.gg/eHVA8rJ2J

## Structure

```
index.html     page markup, styles and logic (EN/RU texts, FAQ, roadmap)
support.js     page runtime (generated — do not edit by hand)
assets/        images: backgrounds (webp), logo, doge gif, og.jpg link preview
assets/news.js puppy news headlines for the ticker (EN + RU, edit freely)
metrics.json   live token data (refreshed by GitHub Actions)
assets/metrics.js  same data as a script, used by the page (works from file:// too)
api/           metrics.js — Vercel serverless function with live metrics
scripts/       fetch-metrics.mjs — pulls data from Quainance
.github/       workflows/pages.yml — build + deploy to GitHub Pages
```

## Run locally

Open `index.html` in a browser — no build step needed.
Some browsers restrict `file://` pages; if something doesn't load, serve the folder:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Workflow

- `main` is always the live, working version of the site.
- Every change goes in its own branch (`feat/...`, `fix/...`, `content/...`)
  and lands in `main` through a Pull Request.
- Commit messages: short, imperative, in English
  (e.g. `Link Telegram button in community section`).
- Images go to `assets/` with lowercase, dash-separated names (`mars-bg.png`).

## Deploy

GitHub Actions (`.github/workflows/pages.yml`) deploys the site on every push to
`main` and every 30 minutes. Each run refreshes `metrics.json` (market cap,
price, liquidity, holders) from Quainance. Settings → Pages → Source must be
**GitHub Actions**.

Locally the cards show the snapshot stored in `assets/metrics.js`.
