# $QOGE — landing page

Landing page for **$QOGE** — the very good boy who accidentally colonized Mars.

- X / Twitter: https://x.com/QOGEofficial
- Telegram: https://t.me/QOGEofficial

## Structure

```
index.html     page markup, styles and logic (EN/RU texts, FAQ, roadmap)
support.js     page runtime (generated — do not edit by hand)
assets/        images: backgrounds, logo, doge gif
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

## Publishing changes (Windows)

- `tools/first-push.bat` — one-time: init repo and push to GitHub over SSH.
- `tools/publish.bat` — commit everything and push. Commit message is taken from
  `tools/commit-message.txt` if present (ignored by git).

## Deploy

Hosted on GitHub Pages from the `main` branch (Settings → Pages).
