# Physical Mac test results — TEMPLATE (no results recorded)

Copy to a dated document under docs and replace placeholders with observed evidence. Keep unavailable checks UNVERIFIED; this template is not a passing report.

## Identity

- Date / tester:
- Mac model / Apple Silicon chip / RAM:
- macOS version and build:
- Terminal / Node / Rust architectures:
- Developer tools / SDK:
- Node / npm / Rust versions:
- Source branch / exact commit / clean or dirty:
- Artifact lane: frozen private candidate OR local source evaluation (choose one):
- DMG filename / exact byte size / SHA-256:
- Bundle identifier / executable architecture / minimum OS:
- Signing / notarization assessment:
- Dedicated test user and profile isolation confirmed (no personal username needed):

## Automated checks

| Command | Exit code / counts | Sanitized log location |
| --- | --- | --- |
| npm ci | UNVERIFIED | |
| npm test | UNVERIFIED | |
| npm run build | UNVERIFIED | |
| cargo fmt --manifest-path src-tauri/Cargo.toml --check | UNVERIFIED | |
| cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings | UNVERIFIED | |
| cargo test --locked --manifest-path src-tauri/Cargo.toml | UNVERIFIED | |
| npm run test:cargo-lock | UNVERIFIED | |
| git diff --check | UNVERIFIED | |
| Apple Silicon DMG build | UNVERIFIED | |

## Observed smoke tests

| Check | PASS / FAIL / BLOCKED / UNVERIFIED | Evidence / timing / fixture identity |
| --- | --- | --- |
| Normal install and first launch; Gatekeeper dialog | UNVERIFIED | |
| Window/dialog/keyboard behavior | UNVERIFIED | |
| PDF import; original relocated; owned copy survives | UNVERIFIED | |
| PDF Open in default viewer | UNVERIFIED | |
| Document Reveal and Settings Open folder | UNVERIFIED | |
| Material/tag create/edit/replace/retry/Cancel | UNVERIFIED | |
| Automatic 1,050-page split; ordered coverage and limits | UNVERIFIED | |
| Automatic image-heavy split; coverage and limits | UNVERIFIED | |
| Manual valid/invalid ranges; rollback/cleanup | UNVERIFIED | |
| Concurrent autosave/split/backup; retry bounds | UNVERIFIED | |
| Backup to Downloads; finalized file and integrity | UNVERIFIED | |
| Backup credential-entry inspection | UNVERIFIED | |
| Restore; conserved records and document hashes | UNVERIFIED | |
| Corrupted archive refusal / original recovery | UNVERIFIED | |
| Offline saved guide/flashcard/practice-test visibility | UNVERIFIED | |
| Optional live Gemini with synthetic selected PDF | UNVERIFIED | |
| Upgrade over identified synthetic prior dataset | UNVERIFIED | |
| Symlink and case-insensitive volume behavior | UNVERIFIED | |
| Case-sensitive volume behavior | UNVERIFIED | |
| Early macOS 12 behavior | UNVERIFIED | |

## Findings and follow-up

For each failure: priority, trigger, exact error, expected/observed behavior, source/artifact identity, safe reproduction, suspected or confirmed root cause, proposed bounded repair and regression test.

Record remaining OS, signing, installed-app, live API and release limitations. Never include actual secrets, user databases, private documents or uncensored personal screenshots. A successful current-Mac run does not certify an unavailable OS or a different DMG.
