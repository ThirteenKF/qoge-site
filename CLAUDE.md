# Notes for Claude — QOGE site

Context for picking this project up in a new chat.

## Project
- Landing page for the $QOGE memecoin (doge that colonized Mars).
- Repo: https://github.com/ThirteenKF/qoge-site (public, branch `main`)
- Live site: https://thirteenkf.github.io/qoge-site/ (GitHub Pages, from `main` / root)
- Local folder on the owner's PC: `C:\Users\0x13kf\Desktop\QOGE SITE\qoge-site`
  (the parent `QOGE SITE` folder holds the original export — do not edit it)

## Files
- `index.html` — all markup, styles and logic (EN/RU dictionary, FAQ, roadmap,
  ticker). Exported from a design tool; several hero/section variants live in
  one file, switched by `heroVariant` (default: "Breaking News").
- `support.js` — generated runtime, loads React from unpkg. Do not edit.
- `assets/` — mars-bg.png, earth-bg.png, logo.jpg, doge.gif.

## Links
- X: https://x.com/QOGEofficial
- Telegram: https://t.me/QOGEofficial
- DexScreener, Chart buttons: still `href="#"` — waiting for URLs.

## How we work
- Claude cannot push to GitHub directly. Claude edits files in the local folder
  and writes the commit message to `tools/commit-message.txt`.
- The owner runs `tools/publish.bat` (asks for the SSH key passphrase) →
  commit + push → Pages redeploys in ~1 min.
- Keep `main` working; commit messages short, imperative, English.
