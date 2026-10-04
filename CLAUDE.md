# Her Flight Deck — notes for Claude

A private flight-training companion for one learner who has **not enrolled in
flight school yet**: school, instructor and start date stay optional everywhere.
`PRODUCT_SPEC.md` is the source of truth for purpose, terminology and visual
direction. Read it before changing wording or design.

## Where to look first

- `docs/PROJECT_HANDOFF.md`: current task ownership and the handoff rules both
  machines follow. The top of `STATUS.md` has the latest state; the file is
  long, so read only the top entries.
- `README.md`: running, releasing, Gemini and data-safety guarantees.
- `ROADMAP.md`, `AUDIT.md`, `docs/*`: plans, reviews and dated evidence. Open
  them only when the task points there.

## Stack

Tauri 2 desktop app. React 19 + TypeScript + Vite frontend in `src/`, Rust in
`src-tauri/src/`, SQLite via `tauri-plugin-sql`.

| Path | Holds |
| --- | --- |
| `src/pages/*` | One folder per screen (Flight Deck, Flight Path, Study Library, …) |
| `src/components/*` | Shared UI; primitives in `components/ui` |
| `src/data/` | DB access, repositories, migration list and checksums |
| `src/logic/` | Pure logic with tests (daily plan, actions, AI limits, …) |
| `src/state/` | React context and hooks |
| `src/services/` | Frontend wrappers for Rust commands (Gemini, backups, PDF, documents) |
| `src-tauri/migrations/` | SQL migrations, shared by desktop and browser mode |
| `src-tauri/src/` | Backup/restore, storage, Gemini client, secrets, PDF, study packets |

`npm run dev` is **browser mode**: the same SQL on a WebAssembly SQLite in
`localStorage`, with file import and Gemini disabled. The real app always uses
the desktop database. `isTauri()` in `src/data` tells the two apart.

## Commands

```bash
npm test                      # vitest (src/**/*.test.ts)
npx vitest run src/logic/dailyPlan.test.ts   # one file
npm run typecheck
npm run build                 # typecheck + bundle; cargo needs dist/ to exist
cargo test  --locked --manifest-path src-tauri/Cargo.toml
cargo fmt   --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:cargo-lock       # Cargo.lock in sync
```

CI (`.github/workflows/checks.yml`) runs all of these on every PR. Changes that
touch only Markdown or `docs/` take a lightweight path. Run the relevant
checks before pushing.

In cloud sessions `.claude/hooks/session-start.sh` installs everything first,
including the Linux WebKit libraries, within a 900-second budget. npm packages
come only from the committed lock (`npm ci`); `node_modules` is reused only
when it provably matches that lock, and setup fails rather than change a
manifest or lockfile. It does nothing on a local machine. To see UI changes,
use the `run` skill (`.claude/skills/run/`), which screenshots browser mode.
Both helpers' checks: `node --test .claude/tests/setup-helpers.test.mjs`.

`.claude/settings.json` pre-approves development commands only: tests, type
checks, builds, `cargo check/test/fmt/clippy`, the screenshot helper and some
git commands. Not all of them are read-only: `cargo fmt` rewrites files and
`git fetch` updates remote refs. Nothing pre-approved pushes, releases or
installs packages.

## Rules that protect her data

- **Migrations only ever add.** Never edit or rename an existing file in
  `src-tauri/migrations/`. Add a new numbered file and register it in
  `src/data/migrations.ts`. `migration-checksums.json` and the tests reject
  edits, drops and renames. Installed databases refuse to open if a shipped
  migration changes.
- **Never change the bundle identifier** `com.herflightdeck.app`. Her data
  folder is keyed to it.
- Backup, restore and pre-update copies are guarded by Rust tests. Keep those
  guarantees intact (see "Her data survives updates" in the README and
  `docs/backup-format.md`).
- Change the version only with `scripts/release.sh` (or
  `scripts/bump-version.mjs`). The version lives in five places that must
  agree: `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`. Never reuse a retired
  version (`scripts/release-policy.json`).
- The Gemini API key is typed into Settings, held briefly in React state and
  passed once to the native `configure_gemini` command
  (`src/services/gemini.ts`); the field is then cleared. From then on Rust
  keeps it in a file in the app data folder and the webview only gets status
  back, never the stored key. That brief webview entry is a known, tracked
  limitation (MAC-16). The key is never stored in SQLite, included in a
  backup or committed.

## Conventions

- New dependencies are gated: see `docs/OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md`.
  Do not add a package without the owner agreeing.
- Tests sit next to the code as `*.test.ts`. Pure logic belongs in `src/logic`.
- User-facing text is written for her, not for a developer: warm, plain and
  encouraging. AI-generated aviation material is always labelled as a study
  aid to check against FAA guidance and her instructor.
- Forms use `<dialog>` through `src/components/ui/useModalDialog.ts`. The
  macOS minimum is 12.0, but native `showModal` arrived only in WebKit 15.4
  (macOS 12.3), so the hook feature-detects it and falls back to its own
  modal behavior. Keep that fallback working. The fallback is covered by
  source tests; behavior on an installed macOS 12.0–12.2 Mac is still
  unverified.
- Never tell anyone to bypass Gatekeeper, SmartScreen or Defender.
- Keep secrets, real databases, private documents, installers, `node_modules`
  and `target/` out of Git.
