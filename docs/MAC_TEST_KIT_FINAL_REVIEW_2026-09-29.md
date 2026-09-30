# Mac test-kit final independent review

Date: 29 September 2026. Reviewer/Git coordinator: Codex. Repository: `rickydeleon49-ui/Flight-training-`. Reviewed base: `c241c4a84dcad6539fea90cbaa48e0f15c92d553`.

**Approve this test/tool/documentation slice for a pull request. Full application release approval remains held.** The confirmed test-kit review findings are resolved. The product findings in [the full repository audit](FULL_REPOSITORY_AUDIT_2026-09-29.md) remain open; this change does not repair restore rollback, ordinary material-save atomicity, early macOS 12 compatibility, offline saved-study visibility, or retry-time messaging.

## What was independently reviewed

- Backup credential-entry inspection now rejects the reproduced EOCD undercount and zero-count archives instead of reporting PASS. Supported ZIP directory boundaries, record fields and corresponding local filenames are checked. Missing/unreadable/unsupported input is an inspection error. This is entry-name inspection, not arbitrary-content secret scanning or the app's backup integrity validator. The Node tool conservatively rejects ZIP64/multi-disk layouts; use the documented native Mac inspection and app integrity validation where necessary.
- The literal documented shell alternative distinguishes a credential match, a successful no-match and an inspection/tool error. Its tests observe removal of the temporary listing after success, credential failure, archive-listing failure and search failure. Missing Bash is explicitly reported as unavailable/skipped rather than as a passed execution.
- The shared JavaScript fixture generator is used by the documented CLI and frontend tests. The duplicate inline generator was removed. Accepted input hashes and sizes remain unchanged.
- Rust fixture checks invoke existing extraction helpers and decode every output page's identifier. They verify complete ordered source coverage, both limits, manual ranges and source immutability. A negative test rejects wrong, duplicated and reordered identities, including a valid three-page PDF with duplicate page content.
- New Rust code is confined to the existing test module. No application behavior, migration, archive format, dependency, Tauri capability, bundle identifier or version record changed. The release workflow change corrects its draft-creation description; it does not change publication behavior.

## Fresh local verification by Codex

Windows x64 host; Node 24.16.0/npm 11.13.0; Rust 1.98.1. These are source/helper checks, not installed-app tests or Mac performance measurements.

| Command | Result |
| --- | --- |
| `npm ci --cache <Codex audit npm cache> --no-audit --fund=false` | Passed; 165 packages installed; 33 s |
| `npx vitest run src/logic/releaseSafety.test.ts --configLoader runner` | 51 passed, 1 explicit skipped availability scenario; real Git Bash routine ran; 3.80 s total |
| `npm test -- --configLoader runner` | 594 passed, 4 skipped; 59 files passed, 3 files skipped; 36.55 s total |
| `npm run build` | Typecheck and production build passed; Vite build 1.94 s; entry 381.14 kB / gzip 118.55 kB |
| `cargo fmt --check --manifest-path src-tauri/Cargo.toml` | Passed |
| `cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml --locked -- -D warnings` | Passed, no warnings |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked` | 161 passed, 6 ignored; 30.81 s test time |
| `cargo test --manifest-path src-tauri/Cargo.toml opt_in_byte_heavy_charts_fixture_split --locked -- --ignored --nocapture` | 1 passed; all output IDs/manual ranges, both limits and source hash asserted; 13.33 s test time |
| `npm run test:cargo-lock` | Passed; Cargo manifest/lock synchronized at 0.5.3 |
| `node scripts/check-release-version.mjs 0.5.3` | Passed version-policy check; this is not release approval |
| `git diff --check` | Passed |

The installation uses an explicit cache under the Codex workspace, not the owner's app-data profile. Tests use synthetic files and disposable database/profile directories. No owner app-data repair or deletion was performed. The earlier dependency-advisory results remain attributed to the separate full audit; vulnerability scans were not repeated for this unchanged-dependency slice.

## Fixture and platform limits

Input specifications remain 10 pages / 3,360 bytes, 1,050 pages / 330,934 bytes, and 60 pages / 54,032,644 bytes. The image fixture uses 600×500 RGB rasters, 900,000 uncompressed bytes per page. Full input SHA-256 hashes are in [the Mac tracker](MAC_PARITY_CHECKLIST.md).

The extraction assertions establish output identity and boundaries using the actual Rust helpers on Windows. They do not establish packaged Tauri progress/record creation, total memory bounds, live Gemini behavior, Finder/Preview integration or a Mac speedup. Input hashes are reproducible specifications; output serialization sizes/hashes must be recorded from the actual designated candidate and are not universal cross-version/platform acceptance constants.

No physical Apple Silicon installation, minimum-macOS WebKit test, native PDF Open/Finder reveal, installed backup/restore, live Gemini generation or installer build was performed. All physical Mac tracker items remain UNVERIFIED.

The private v0.5.3 DMG remains frozen evaluation evidence with known source defects. No tag, draft asset, policy or version is changed by this slice. Future release acceptance requires product repairs, an explicit candidate/version decision and testing of the exact bytes proposed for publication. Windows distribution remains held on v0.5.1. CI on the exact PR head is the remaining merge gate; CI packaging alone cannot authorize a Mac release.

## Next work

Claude should implement failed-restore recovery retention and restart safety first, with deterministic failure-injection and restart tests. Codex owns independent review and subsequent Git coordination. Keep atomic material saves, macOS minimum compatibility and offline-study repairs separate from this approved test-kit scope.
