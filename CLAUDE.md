# Notes for coding agents

Your Flight Deck is a study companion for student pilots: a Tauri 2 desktop app
(React 19 + TypeScript + Vite in `src/`, Rust in `src-tauri/src/`, SQLite via
`tauri-plugin-sql`). `README.md` covers running, building and offline search.
School, instructor and start date stay optional everywhere.

## Layout

| Path | Holds |
| --- | --- |
| `src/pages/*` | One folder per screen |
| `src/components/*` | Shared UI; primitives in `components/ui` |
| `src/data/` | DB access, repositories, migration list and checksums |
| `src/logic/` | Pure logic with tests |
| `src/state/` | React context and hooks |
| `src/services/` | Frontend wrappers for Rust commands |
| `src-tauri/migrations/` | SQL migrations, shared by desktop and browser mode |
| `src-tauri/fixtures/`, `src/testing/fixtures/` | Shared test contracts and fixtures |

`npm run dev` is browser mode: the same SQL on a WebAssembly SQLite, with file
import and Gemini disabled. `isTauri()` in `src/data` tells the two apart.

## Gates (use Node 22; newer Node gives false test failures)

```bash
npm run typecheck
npm test                      # vitest (except src/perf); one file: npx vitest run <path>
npm run test:perf             # the 1,000-card Study Library tier, one file at a time
npm run build                 # typecheck + bundle; cargo needs dist/ to exist
npm run hygiene               # no local paths, account names or personal emails
cargo test   --locked --manifest-path src-tauri/Cargo.toml
cargo fmt    --manifest-path src-tauri/Cargo.toml --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:cargo-lock       # Cargo.lock in sync
node --test scripts/build-signed-mac.test.mjs
git diff --check
```

CI (`.github/workflows/checks.yml`) runs these on every pull request. Use
default test settings (no custom timeouts). Native tests wait with the shared
`src-tauri/src/test_wait.rs` helper, never fixed short loops; frontend
timeouts are global (`vite.config.ts`, `src/testing/vitestSetup.ts`).
`cargo test` takes one name filter.

## Rules that protect user data

- **Migrations only ever add.** Never edit or rename a file in
  `src-tauri/migrations/`. Add a new numbered file and register it in
  `src/data/migrations.ts`; `migration-checksums.json` and the tests reject
  edits, drops and renames.
- **Never change the bundle identifier** `com.herflightdeck.app`; the data
  folder is keyed to it.
- Backup, restore and pre-update copies are guarded by Rust tests. Keep those
  guarantees intact.
- Change the version only with `scripts/release.sh` (or
  `scripts/bump-version.mjs`). It lives in `package.json`, `package-lock.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`.
  Never reuse a retired version (`scripts/release-policy.json`).
- The Gemini API key goes from Settings straight to the native
  `configure_gemini` command and the field is cleared. Rust stores it in the app
  data folder; the webview only gets status back. Never store it in SQLite, a
  backup, a log or Git.

## Conventions

- **Keep the app simple** for a student pilot. Prefer fewer screens, fewer
  options and plain words.
- No new dependencies without the maintainer's agreement.
- Tests sit next to the code as `*.test.ts`; pure logic belongs in `src/logic`.
- User-facing text is warm, plain and encouraging. AI-generated aviation
  material is always labelled as a study aid to check against FAA guidance and
  an instructor.
- Forms use `<dialog>` through `src/components/ui/useModalDialog.ts`, which
  falls back when native `showModal` is missing (macOS 12.0–12.2). Keep that
  fallback working.
- Never tell anyone to bypass or weaken operating-system protections (no
  quarantine removal, no `spctl --master-disable`, no SmartScreen bypass). Mac
  releases are signed and notarized with `scripts/build-signed-mac.sh`.
- Tests use synthetic data only: no real API key, profile, private PDF, or
  network beyond loopback test servers.
- Keep secrets, real databases, private documents, installers, absolute local
  paths, `node_modules` and `target/` out of Git.
