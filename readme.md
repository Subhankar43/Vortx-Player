# Vortx Player

Paste a video link (HLS, DASH, MP4, WebM) and watch it in the browser, powered by JW Player.

- Two looks: **Glass** (iOS-style glassmorphism) and **Cinema** (dark, theater-first)
- Shareable links (`?url=...&sub=...`), recently played list, resume where you left off
- Optional subtitles (.vtt), theater mode, keyboard shortcuts
- No build step and no dependencies apart from the JW Player script

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup and icon sprite |
| `style.css` | Both themes, layout, JW Player skin |
| `app.js` | Theme switch, playback, history, sharing |
| `netlify.toml` | Static deploy settings |

## Run locally

Serve the folder with any static server, for example `npx serve .`.
Opening `index.html` straight from disk (`file://`) only partly works, because JW Player and the clipboard need http(s).

## Credits

Made by Hash Hackers, Vortx and Bhadoo. Feel free to fork and deploy your own.