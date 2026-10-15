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
node .claude/skills/run/screenshot.mjs /journal --width 390   # phone width
```

- The app uses `HashRouter`, so the server serves only `/` and the screen is
  picked by the fragment: in a browser, `/finances` shows the Flight Deck home
  page and only `/#/finances` shows Finances. Give routes in the form listed
  below (`/finances`); the helper loads them as `/#/finances`. `/#/finances`,
  `#/finances` and `finances` are accepted too.
- After each load it checks that the app is showing the requested route and
  exits 1, without writing that screenshot, if it shows another screen, the
  "That page isn't here." screen, or no app shell at all (still loading, or
  the data-recovery screen).

- Starts Vite on port 1420 if nothing is listening there, and stops it
  afterwards, including after a failure. A server that was already running is
  reused and left running. Every wait is bounded, so a server that accepts
  connections but never answers cannot hang it.
- Uses a fresh, isolated browser context. A screenshot is UI evidence only: it
  cannot show installed macOS behavior, native pickers, persistence or
  VoiceOver.
- Writes PNGs to `screenshots/` (git-ignored; `--out DIR` to change it),
  named after the route with no `#`: `/` → `home.png`, `/finances` →
  `finances.png`, `/journal/new` → `journal_new.png`. Two routes that would
  share a file name are refused before anything starts.
  Look at them with the Read tool, then send the useful ones to the user.
- There is no dark theme. The product has one warm light palette and
  `src/styles/tokens.css` pins `color-scheme: light`. `--dark` emulates a dark
  macOS appearance (`prefers-color-scheme: dark`) so you can confirm nothing
  turns dark with it; the pages still render light, and the files are named
  `…-os-dark.png` to make that clear.
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
