---
name: run
description: Launch Her Flight Deck in browser mode and screenshot pages, to see a UI change working rather than only passing tests. Use when asked to run, preview or screenshot the app, or after changing a page, component or stylesheet.
---

# Running Her Flight Deck in a cloud session

The desktop window (`npm run tauri dev`) cannot be shown here. Browser mode
(`npm run dev`) renders the same React UI against the same SQL, using a
WebAssembly SQLite kept in `localStorage`. File import and Gemini are
disabled in that mode, so verify those on the desktop build instead.

## Screenshot pages

```bash
node .claude/skills/run/screenshot.mjs / /study /settings
node .claude/skills/run/screenshot.mjs /journal --dark --width 390   # phone width, dark
```

- Starts Vite on port 1420 if needed and stops it afterwards.
- Writes PNGs to `screenshots/` (git-ignored; `--out DIR` to change it).
  Look at them with the Read tool, then send the useful ones to the user.
- Exits non-zero and prints them if the page logged errors.

Routes: `/`, `/flight-path`, `/study`, `/schedule`, `/journal`,
`/journal/new`, `/questions`, `/notes`, `/finances`, `/toolkit`, `/settings`.

Every browser session starts on an empty database with the starter content.
To check a page with data on it, drive the UI with Playwright first (copy
`screenshot.mjs` into the scratchpad and add the clicks) rather than adding
fixtures to the app.

## On a Mac

`npm run tauri dev` for the real desktop app. `scripts/desktop-smoke.sh`
drives the real window on Linux only.
