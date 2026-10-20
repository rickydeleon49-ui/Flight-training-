# GEN-FIX-1 implementation report — 20 October 2026

Codex implements; Claude reviews/tests/merges. Implemented only GEN-FIX-1; pending independent review. Everything remains uncommitted.
New jobs start at 300 s; measured rate is 0.8 × min(cumulative, latest window), after 1 s / 64 KiB, sampled at most once per second; unknown/buffered/zero windows select 600 s. Allowance only increases, from the original start; connect stays 15 s.
Upload progress comes from 256 KiB aligned chunks in one existing resumable session, with one finalization. This avoids a dependency; acknowledgements remain a rate estimate. Real-provider chunk behaviour and installed behaviour are UNVERIFIED; no real host/key/profile was used.
Each sample/extension merges timing into the latest draft before further dispatch; write failure retains the old allowance. Upload request snapshots use the absolute ceiling while live guards enforce the selected allowance. Cache-hit coverage proves 300 s without another upload.
Optional timing policy measured-rate-v1 stores ceilingMillis, allowedMillis, remainingMillis, deadlineUtc (Unix ms), uploadBytes (total), sampleMillis and sampleBytes (observed). Old drafts stay frozen; reopen is Interrupted with no resend. Both restoration and shortening retain min(persisted remaining, wall remainder, prior monotonic deadline).
Timing-only practice drafts are hidden from card-draft UI. Card ledger/admission caps remain intact. No dependency, SQLite migration, public command signature or later-slice change. Pre-existing untracked node_modules remains untouched.

## Receipts (all under docs/evidence/offline-gen-fix1-2026-10-20)
Every gate uses receipt.py; Cargo uses the requested SDKROOT, worktree target and CARGO_NET_OFFLINE=true. Node 22 is first in PATH; Vite uses --configLoader runner.
`failing-first.log`: EXIT 101; all seven requested names failed by assertion (0 passed / 7 failed). Test-only fixed-budget compatibility adapters were removed after the native policy APIs existed.
`rate-first-green.log`: EXIT 101, compile error (fake headers Vec indexed as map); fixed. `rate-second.log` and `cargo-restoration.log`: EXIT 0 each, 7 passed each.
`gemini-first.log`: EXIT 101, 208 passed / 1 failed / 1 ignored; old large-PDF byte count counted only final chunk. Updated deliberately to count every upload chunk, preserving exact source bytes and one finalization.
`cargo-gemini.log`: EXIT 0, 211 passed / 1 ignored. `cargo-gemini-final.log`: EXIT 0, 213 passed / 1 ignored, including cache-hit and cancellation-at-sample loopback regressions.
`cargo-full.log`: EXIT 0, 849 unit + 13 service + 15 worker = 877 passed / 11 ignored. `cargo-full-final.log` and `cargo-full-restoration.log`: EXIT 0 each, 851 + 13 + 15 = 879 passed / 11 ignored.
`npm-test.log`, `npm-test-final.log`: EXIT 0 each; 194 files passed / 4 skipped; 4,089 tests passed / 6 skipped, zero unhandled errors.
`typecheck-first.log`, `typecheck-final.log`, `build.log`, `build-final.log`, `cargo-lock.log`, `clippy.log`, `clippy-final.log`: EXIT 0 each (no test counts).
`fmt-write.log`, `fmt-second-write.log`, `fmt-final-write.log`, `fmt-restore-write.log`, `fmt-check.log`: EXIT 0 each. `diff-check.log`: EXIT 0.
`schema14-before-rebind.log`, `schema14-rebound.log`: EXIT 1 each; 25 passed / 1 failed. Sandbox pgrep emits sysmond/process-list errors before the expected REFUSED prefix; the operator refusal still occurs. Helper source/tests unchanged; Claude must rerun outside sandbox.
`manifest-verify.log`: EXIT 0; 20 manifest entries and 21 checksum entries matched; flycheck0 absent. ROADMAP changed only by the requested approval/pending-review line; schema-14 manifest/checksums rebound.
S1 upload/remainder, S2 headers and S3 body now succeed with qualifying fallback, with reasons at changed assertions; S4 succeeds with identical generation bodies and one PDF upload; S5 succeeds unchanged. Deliberately over-cap headers fail at the 600 s scaled ceiling without a late submission. Estimate coverage is arithmetic, not measured provider latency.

## User-facing wording
Only new progress line: “Your PDF is still uploading. A slower connection can take a little longer.” Shown once during uploading after one second; Cancel remains visible. Preparing, Uploading, Waiting for file, Generating, Reading, Validating and Pausing wording and Gemini study-aid provenance are retained; no model-progress claim.
Timeout templates retain stage wording and interpolate the actual selected allowance through describe(budget.total()): “Google did not finish {doing} within the {allowance} Her Flight Deck allows for one study aid…”; “Gemini did not answer within the {allowance}…”; “Gemini started answering, but the rest did not arrive within the {allowance}…”; “Google was still preparing this PDF when the {allowance}…ran out”; outer guard: “Her Flight Deck stopped before {doing}: the {allowance} it allows for one study aid had run out.” Full retained wording is in gemini.rs / gemini_files.rs; over-cap receipt proves actual allowance text.
Empty-upload guard: “The selected PDF is empty.” No real-provider or installed success claim.

## Changed files — SHA256 (report itself and receipts are bound by E/SHA256SUMS)
| File | SHA256 |
|---|---|
| `ROADMAP.md` | `1878a3c4fd23e465cf03b24bacd4b9581cfcd22fc842f9c100ae5251c0d0e21e` |
| `docs/evidence/mac-schema14-completion-2026-10-15/SHA256SUMS` | `43e79fefae8aaaa9aa88f80818f3d3db1c4e86b8041e4239867f74ce4f8500e5` |
| `docs/evidence/mac-schema14-completion-2026-10-15/source-manifest.json` | `c766feda341df40b9e71f3b4c9da0f01b184a6a960bb5f5ae59762524bf78da6` |
| `src-tauri/src/fake_gemini.rs` | `9a312ec52f5e92291bb2faf3727acdc50d6b93ca1d896d27bd13c06d2937d530` |
| `src-tauri/src/gemini.rs` | `9de379e675c0dd1b28f80eed59d9b72ce188570ab6c1bbcdfbfd5881ef2cef06` |
| `src-tauri/src/gemini_batches.rs` | `009ad8d721e6d492081534daba4fe7044fdb4deba785297abcc9abb5167ff6f3` |
| `src-tauri/src/gemini_budget.rs` | `252c776640cf6357bbbf9763461c6b4f52c0f7fe060d43afc06209ef87ade794` |
| `src-tauri/src/gemini_files.rs` | `0e279851f50ef56de32c8a0068db931e2f894d1354f8fdf55acd5e59c225bb8f` |
| `src-tauri/src/gemini_generation_tests.rs` | `89c24a11376a44d98e212563ec2849082e217771084eac40bd72fc9bb0c879bc` |
| `src-tauri/src/gemini_jobs.rs` | `df69ea5076b621b5fe91a94f80c97ffdd5c9bd92e161287aa691d3be8c7f5a38` |
| `src-tauri/src/gemini_rate_tests.rs` | `ac15ffec9202ea9788e9ebc65e61aebb31a7737ee4a37ce63b04bd9f24a3afc0` |
| `src-tauri/src/gemini_slowlink_tests.rs` | `a8e479e692de282a39318176a09ce899946f7df12b594e9a72414b17485a7d40` |
| `src/pages/StudyLibrary/GeminiJobNotice.tsx` | `2c57662ffd48ea5227e6b91e60abca4cae73b939256a2876f4ce9c7fe186d16b` |
| `src/pages/StudyLibrary/GeminiProgress.test.ts` | `4fd0b2410aa1f5aa25138e22377c8fd2cbc2954693713aacd653f303b1c5ecb5` |
| `src/services/gemini.ts` | `d38ade51a2664fa19491c12ae4dc76f2a29af7258ff0aac02548b1d3990b1159` |
| `src/state/GeminiJobs.tsx` | `c9c64a291da5761e3521f0e811ef740f533d3fbe42e0c93c3566568d11dda6c6` |

## Correction r1
STOPPED at required lockfile gate: enabling reqwest `stream` adds one new package, `wasm-streams 0.4.2`; no package was removed.
`cargo-feature-update.log`: EXIT 0 (`cargo check` without `--locked`, requested SDKROOT/target/offline environment); no tests run.
Saved full `git diff src-tauri/Cargo.lock` as `correction-r1/Cargo.lock.diff`; package audit is `lockfile-package-audit.txt` beside it (1 added / 0 removed).
The diff adds reqwest edges to futures-util, tokio-util and wasm-streams 0.4.2, disambiguates reqwest 0.13's existing wasm-streams 0.5.0 edge, and adds the 0.4.2 package entry.
The correction explicitly requires stopping if any new package entry appears; focused/full Cargo tests, fmt, clippy, cargo-lock, npm test, typecheck, build and diff-check were therefore NOT RUN for r1 (no EXIT or counts).
Protocol remains the previous multi-request resumable chunks; the single-request streamed upload and test updates are NOT implemented. Earlier report receipts do not validate r1.
Only Cargo.toml/Cargo.lock were changed for r1, plus this appended report and new evidence. All remain uncommitted; no provider, key, profile or non-loopback endpoint was used.
A separate implementation constraint also needs resolution: wrap_stream requires futures Stream, which the current direct dependencies do not expose; a direct already-locked futures-core edge would change the application's lockfile list too.
Evidence/report helper first exited 1 before writing anything (system Python lacks tomllib); rerun uses text parsing and succeeds (EXIT 0).
SHA256 `src-tauri/Cargo.toml`: `9a1af5d409485610566412ea3189eee85dc224f9a116771cb5661411e0775bee`.
SHA256 `src-tauri/Cargo.lock`: `4ba71a5d7f9935fc062f2c61337862735f7504e0b0da0159db993e0fd2c10f6f`.

## Correction r2
Owner approval (20 October 2026): direct `http-body = "1.1"`, using the already-locked 1.1.0; no other direct dependency approved.
Reverted reqwest `stream`; `git checkout -- src-tauri/Cargo.lock` EXIT 128: shared Git metadata is outside sandbox write roots (captured in `correction-r2/git-checkout.log`).
Cargo regenerated the required baseline lockfile plus only the application http-body edge; exact-content audit against HEAD passed, with 0 package additions, 0 removals and 0 version changes.
`correction-r2/cargo-dependency-update.log`: EXIT 0, `cargo check` without --locked under the requested SDKROOT/target/offline/Node PATH; no tests run.
`correction-r2/lockfile-package-audit.txt`: EXIT 0; saved full diff as `Cargo.lock.diff` and audit source as `audit.py`.
STOPPED at step 3: bytes is not a direct dependency, and cached reqwest 0.12.28 privately imports bytes::Bytes without re-exporting it. Direct bytes approval is needed before implementing the required Body<Data = bytes::Bytes>.
Protocol remains the existing multi-request resumable chunks with one finalization; the requested offset-0 single upload, finalize request is NOT implemented.
Focused/full Cargo tests, fmt, clippy, cargo-lock, npm test, typecheck and build were NOT RUN for r2 after this explicit stop condition (no EXIT or test counts); earlier receipts do not validate r2.
No loopback/provider traffic was needed; no socket or pgrep failures occurred in r2. Everything remains uncommitted; unrelated dirty work is preserved.
SHA256 `src-tauri/Cargo.toml`: `0fc6bfbefecf96bb25c708bf3d724b10b1a8effd1a5b444f9610b210884616b8`.
SHA256 `src-tauri/Cargo.lock`: `451be3995e08ec17d6f0fe56ebeda2cff73a9dd1eb48877211fbac88748595eb`.
Report and r2 evidence hashes are recorded in `correction-r2/SHA256SUMS` (excluding that checksum file itself).
`correction-r2/diff-check.log`: EXIT 0; no whitespace errors.

## Correction r3
Owner approvals (20 October 2026): direct `http-body = "1.1"` uses locked 1.1.0; direct `bytes = "1"` uses locked 1.12.1. No reqwest stream feature.
`correction-r3/lockfile-package-audit.txt`: EXIT 0; exact HEAD lockfile plus only those two application edges; 0 package additions/removals/version changes. Full diff saved as `Cargo.lock.diff`.
Protocol supersedes the original chunk implementation: one offset-0 `upload, finalize` request per PDF with full Content-Length; `reqwest::Body::wrap` polls 256 KiB frames with an atomic byte counter and exact remaining size_hint. Multi-request loop removed.
Rate remains a send-side estimate: at least 1 s / 64 KiB, once per second, 0.8 × min(cumulative, window); buffered/unstable samples use 600 s. Paced 1/4 MiB/s readers produced conservative minima 626,016/3,139,449 bytes/s, with partial-sample allowance assertions intact.
`cargo-gemini.log`: EXIT 101, 214 passed / 1 failed / 1 ignored; streamed bodies cannot replay the redirect positive control. Replaced that control with replayable bytes and asserted leaked body bytes; application redirect-refusal assertions retained.
`cargo-gemini-final.log`: EXIT 0, 215 passed / 1 ignored; all seven original failing-first tests and S1–S5 green, plus frame/size_hint and backpressure regressions. No rate/allowance assertion weakened.
`cargo-full.log`: EXIT 0, 853 unit + 13 service + 15 worker = 881 passed / 11 ignored; full `cargo test --locked --no-fail-fast`.
`npm-test.log`: EXIT 1, zero tests started; sandbox EPERM writing .vite-temp through the existing node_modules symlink.
`npm-test-runner.log`: EXIT 0 (`npm test -- --configLoader runner`); 194 files passed / 4 skipped, 4,089 tests passed / 6 skipped, zero unhandled errors.
`cargo-dependency-update.log`, `fmt-write.log`, `fmt-final-write.log`, `fmt-check.log`, `fmt-final-check.log`: EXIT 0 each; no tests (Cargo update ran without --locked).
`clippy.log` (-D warnings), `cargo-lock.log`, `typecheck.log`, `build.log` (--configLoader runner), `diff-check.log`, `worktree-status.log`: EXIT 0 each; no tests.
All r3 receipts are under `docs/evidence/offline-gen-fix1-2026-10-20/correction-r3/`; compilation uses the requested SDKROOT/target/offline Cargo environment, and Node 22 leads PATH. No socket/pgrep failure occurred; traffic was loopback only. Everything is uncommitted; unrelated dirty work preserved.
Full dirty-source SHA256 inventory: `correction-r3/changed-files.sha256` (19 paths). R3-edited source hashes follow:
SHA256 `src-tauri/Cargo.toml`: `0aabe807bf95e70ac29bdb6eee74bdd837944c6daea7b3db1536635ca210a105`.
SHA256 `src-tauri/Cargo.lock`: `df21580a99980837d397df196187a5943c0fa2daa2ca57e1b28eb1fa5ba408f1`.
SHA256 `src-tauri/src/gemini_files.rs`: `7381937303524900bf60b9d2ca4106e30bee797883e76e1dc183e6a7bed1eb69`.
SHA256 `src-tauri/src/gemini_budget.rs`: `25c103040a6cf5b9c649503a125fded389cd9e0d90c789d2fcd1b3f928fa080f`.
SHA256 `src-tauri/src/fake_gemini.rs`: `a6c1fab4767f696360c90900f779853d7d478af9959212a172cdb592883cbdf9`.
SHA256 `src-tauri/src/gemini_files_tests.rs`: `e948d4f85b276a63cc1970ec168f493532b4a2106e0c786db4fecfaf670a57d7`.
SHA256 `src-tauri/src/gemini_generation_tests.rs`: `dda2ec9f55683bf908c70ac3e9d5614cc40824589fe63d03a58256f234a6c73c`.
SHA256 `src-tauri/src/gemini_slowlink_tests.rs`: `51458b2825f12713aa566d5853e3c5f6072fc4505ff5bb17fd4e1edc9a16a0d7`.
The report and all r3 evidence files are bound by `correction-r3/SHA256SUMS`, excluding that checksum file itself.
