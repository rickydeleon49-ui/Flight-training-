# OFFLINE-ON-2b — implementation for Claude review

Uncommitted on `codex/offline-gen`, base `f6ba13a259fcb6203eafb797638ab35f4336cfd2`; expected `node_modules` symlink preserved. No commit, push, tag, version bump, release, dependency, migration, real data or external network use.
Switch set explicitly in `.github/workflows/release.yml` (installer step), `.github/workflows/build-desktop.yml` (both release-profile packaging steps) and `scripts/release.sh` (checks/tag preparation only; never run this round). Existing `scripts/offline-extraction-pressure-check.sh` also opts in only for its disposable release target.
`src-tauri/tauri.conf.json` was audited and left unchanged: `beforeBuildCommand: npm run build` inherits the opt-in, while `beforeDevCommand` stays unchanged. Local packaging requires `HFD_OFFLINE_EXTRACTION=1 npm run tauri build`.
Search path: HFD opt-in → `vite.config.ts` build-only mapping → `VITE_OFFLINE_EXTRACTION` → desktop-only `offlineStudyEnabled()` (`src/services/offlineContent.ts`) → `DocumentSearchPanel`. Native `search_api::submit_search_scoped` → `service::extraction_enabled` → `worker::extraction_enabled` gates both document and saved-content categories, including homework. Rust's compile-time gate remains; debug behavior is preserved. [Single gate reference](../README.md#offline-pdf-reading-and-search).
Failing-first guards: `release_workflow_sets_offline_extraction_opt_in`, `release_build_enables_search_ui`, `debug_and_release_gates_are_documented_in_one_place`. Existing release-safety checks remain intact. Added unopted/debug/browser checks and successful extraction → kit review with no “isn't available in this version yet”; disabled/cache behavior and wording remain covered.
[Copied owner pressure result](evidence/offline-on2b-2026-10-21/RESULT.md): five synthetic fixtures passed at warning level, near-cap 269 MiB RSS, over-cap clean refusal 428 MiB. Owner accepted baseline and saved-search p50 28.2 ms. No new pressure run here.
Caveat: pressure used the owner's **32 GiB M5**, weaker evidence than a minimum-spec Mac. After the update, recommend preparing **one real chapter PDF on her 8 GB Mac with her usual apps open**, with the cap lowered to **384 MiB if slow** in follow-up work. This round leaves the 512 MiB cap and all limits unchanged; installed/8 GB acceptance remains open.
Local gate is not wholly green: schema-14 helper is 25/26 because sandbox-blocked `pgrep` prepends stderr before the expected REFUSED message. Claude must rerun outside the sandbox; no helper/test was loosened.

Receipts below are `.txt` basenames in [evidence](evidence/offline-on2b-2026-10-21/); [receipts.json](evidence/offline-on2b-2026-10-21/receipts.json) records pre-inventory commands, EXITs, summaries and log hashes; the final inventory verification has its own receipt. All gates use the receipt runner, Node 22, prescribed Cargo environment and default test settings; runner loader is used only after recorded Vite temp-write EPERM.
| Receipt(s) | EXIT(s) | Counts / outcome |
| --- | --- | --- |
| `red-guards` | 1 | Vite sandbox temp-write EPERM; no tests ran |
| `red-guards-runner` | 1 | Expected red: 3 failed, 1 passed, 101 filtered/skipped |
| `red-desktop-guards` | 1 | Expected red: 1 failed, 55 filtered/skipped |
| `focused` | 0 | Interim focused run: 102 passed, 1 existing skip |
| `cargo-test-1`, `cargo-test-2` | 0, 0 | Each 1015 passed (987 unit + 13 service + 15 worker), 11 ignored; default parallel mode |
| `npm-test-1`, `npm-test-2`, `npm-test-3` | 0, 0, 0 | Each 4547 passed, 6 skipped; final extra run covers the guard expansion after run 1 began |
| `format`, `fmt`, `clippy`, `cargo-lock`, `typecheck`, `build`, `release-frontend-build` | all 0 | No test count; fmt, strict clippy, lock, typecheck and ordinary/opted-in frontend builds passed |
| `schema14-helper` | 1 | 25 passed / 1 sandbox process-list failure out of 26 |
| `schema14-rebind`, `schema14-checksums` | 0, 0 | 20 manifest entries rebound; 21 schema-14 checksums verified |
| `source-checksums` | 0 | 15 changed source/doc/manifest hashes verified |
| `release-build` | 0 | `HFD_OFFLINE_EXTRACTION=1 cargo build --locked --release --bin her-flight-deck --example offline_pressure_probe`, temporary target |
| `release-gate-proof` | 0 | Probe: `extractionEnabled: true`, `debugAssertions: false`, runtime HFD variable unset; no app/profile opened |
| `release-binary-sha256` | 0 | Both release binary hashes recorded; disposable target then removed |
| `diff-check`, `evidence-checksums` | 0, 0 | Whitespace and final inventory passed; no test count |

SHA-256 of all 15 changed tracked source/doc/manifest files (also [SOURCE_SHA256SUMS](evidence/offline-on2b-2026-10-21/SOURCE_SHA256SUMS)):
```text
d48817e69a38fb5af927f4529c537cf2cdce5221edaf43c74dc8f8d879d427d8  .github/workflows/build-desktop.yml
8eaf8261cdf17efc2e24034e9646473c78fed3c0f2dd9c04018ff96a0640a0c9  .github/workflows/release.yml
a08c1a19570933d0c459e2cd3302ddb648e6f0c6f6b0a6e5affc330299f80a25  README.md
23d8f1b3807745335035a87e02a0dc957950ce3196885282ba5ace9e3bdd895b  ROADMAP.md
b5fafcfc0f8105363ef92cc1553de6a76b2321207aa07e3c59d115b597f7afce  docs/OFFLINE_ON_PRESSURE_CHECK.md
d85e110771decf1c88a4a1e8cb44fe85b56b11bf33052ad1c02fb0d719ab38d4  docs/evidence/mac-schema14-completion-2026-10-15/SHA256SUMS
dc85b7ee6d4dd85b10f0c5075eb12a86f76191bd704484af174f196a4cbf1416  docs/evidence/mac-schema14-completion-2026-10-15/source-manifest.json
58e8afa27368eaa02b14550c229d4c299f77bf6b67cc7cc079b5c629526bb5b8  scripts/release.sh
12b8c386d1d7dd70fbbbdd49e66270562903f7dd8bc5057493d171ee35a09610  src-tauri/examples/offline_pressure_probe.rs
149e3d8c48e2bb6c00fd9548d30c71d218bff902f40a256a17b665f15c5e45a2  src-tauri/src/extraction/worker.rs
9c57d00c1bcacbf0f24e63c759ef455546e5563fcd227aa5a2261f3e015c8ada  src/logic/releaseSafety.test.ts
2afdf6f47cb35ab4cf4316c4536bef76b4cb0a7ee737e3776d2f0c0690945ca0  src/pages/StudyLibrary/MaterialDetailPdfKit.test.ts
663d2c7297eeca906576aca5839519e0c403a944f8e0a0cc5175252925cf4a1c  src/services/offlineContent.test.ts
4677bd88795f2a67682d1887f7c894a729c52e55d88b521e07db0e8ccbb3b68a  src/services/offlineContent.ts
1133d5e0948af8870d5966a56f27c62458503575251e0aeaf54ab622ea253714  vite.config.ts
```
The report, copied RESULT, source inventory, receipts and raw evidence are bound in [SHA256SUMS](evidence/offline-on2b-2026-10-21/SHA256SUMS); it excludes itself and its verification receipt to avoid a checksum cycle. Everything is left uncommitted for Claude; no self-approval or merge.
