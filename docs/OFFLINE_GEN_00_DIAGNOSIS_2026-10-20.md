# OFFLINE-GEN-00 diagnosis — 2026-10-20

## Scope and established facts
- Owner: Codex implements; Claude reviews. Base HEAD: `6d909c51f916ea465513d5ae1a54e5a95f80b002`; setup creation/link steps skipped after verification.
- Test-only changes: three default-off slow-link knobs in `fake_gemini.rs`, seven characterization tests, and a `#[cfg(test)]` module registration in `gemini.rs`. No production behaviour or budget changes.
- `gemini_budget.rs`: one 300 s allowance covers upload, processing, all generation requests, body reads, backoff and cleanup; connect timeout 15 s; maximum three generation attempts.
- `gemini.rs::generate_once`: non-streaming `generateContent`; `.send()` waits for headers (`Generating`), then `.chunk()` reads the body (`Reading`). Schema JSON is parsed/validated only after completion; maximum response 1 MiB.
- `run_generation` also guards the entire operation. A slow upload leaves less time for the model; bytes still arriving do not extend the deadline.
- Most likely reported stage: **Generating**, an inference from “waiting for results” and the estimates below, not a diagnosis of her installed build. Reading remains possible; she has not used GEN-REL-04 progress yet.
- `run_generation_inner` leases one prepared PDF across retries; guide/test cache reuse already avoids duplicate uploads. Ordinary generation retries replay the complete JSON request, not the PDF. A 400/403/404 followed by a missing/not-active file can trigger one re-preparation; an active copy or lookup failure does not.
- No real host, API key, profile, provider docs fetch, dependency install or Git mutation was used. Cargo ran with `CARGO_NET_OFFLINE=true`; fake listeners bind only `127.0.0.1`.

## S1–S5: current behaviour, all assertions pass
The tests follow `gemini_generation_tests` through `study_aid_with` → `run_generation` → `generate_with_retries_at`, using a real synthetic PDF, the generation client and PreparedSources.
Link/deadline scale: **1:100**, so 3 s = 300 s, 3.6 s = 360 s; bandwidth for the same fixture is multiplied by 100. These isolate timing, not a real Mbps payload.
Real monotonic/Tokio time exercises reqwest header/body deadlines; elapsed bounds allow 1 s scheduler tolerance. Retry backoff remains production 1.5–1.875 wall seconds, explicitly unscaled.
All failures assert complete final error text, stage, generation request/attempt count and 3–4 s elapsed; success asserts no error, parsed content, stage, counts and elapsed bounds.

| Case | Fixture (wall seconds) | Final stage / outcome | generateContent count | Measured wall / equivalent |
|---|---|---|---:|---:|
| S1 upload alone | ~3.6 s paced upload, immediate model/body | Uploading; total allowance exhausted | 0 | 3.001 s / 300.18 s |
| S1 budget remainder | ~2.4 s upload + 1.2 s thinking | Generating; no answer before deadline | 1 | 3.001 s / 300.19 s |
| S2 | fast upload + 3.6 s before any headers | Generating; no answer before deadline | 1 | 3.001 s / 300.18 s |
| S3 | immediate headers; 400 B at 100 B/s (4 s) | Reading; partial answer discarded at deadline | 1 | 3.001 s / 300.17 s |
| S4 headers | early partial/drop, backoff, then S2 | Generating; replay cannot finish, no third request | 2 | 3.001 s / 300.18 s |
| S4 body | early partial/drop, backoff, then S3 | Reading; replay cannot finish, no third request | 2 | 3.001 s / 300.16 s |
| S5 upload | same S1 upload, 6 s allowance | Validating; success | 1 | 3.612 s / 361.24 s |
| S5 headers | same S2 thinking, 6 s allowance | Validating; success | 1 | 3.606 s / 360.63 s |
| S5 body | same S3 trickle/content, 6 s allowance | Validating; success | 1 | 4.004 s / 400.42 s |

S1 upload-only observed text: “Her Flight Deck stopped before finishing this study aid: the 3 seconds it allows for one study aid had run out.” The test also permits the complete upload-specific timeout text: the outer guard and reqwest deadline can race.
S2 actually says “Gemini did not answer within the 3 seconds Her Flight Deck allows for one study aid.” The older “did not answer in time” wording is a separate transport helper, not this path.
S3 says “Gemini started answering, but the rest did not arrive within the 3 seconds Her Flight Deck allows for one study aid.” All full messages are in `slowlink.log`.
**S4 corrects the premise:** S2/S3 timeouts consume the remaining allowance and are terminal, so each fits one request and no automatic retry can succeed. Early connection cuts can retry; both S4 tests prove identical complete request bodies and exactly one PDF upload across two attempts.
The fake records uploads only after reading the whole body; S1 upload-only has one upload-start and zero completed finalize records at return. Small loopback uploads can already be socket-buffered; the knob models paced server consumption/finalize latency, not a physical TCP bandwidth emulator.
All knobs default off; existing fake-server consumers passed in the focused and full suites. Zero rate is treated as off, avoiding division by zero.

## Arithmetic estimates (27 combinations, no network)
Decimal MB/KB; upload rate R Mbps; assume download also R Mbps, processing 10 s, response 50,000 B, no protocol overhead or retries.
`upload = 8 × MB / R`; `download = 0.4 / R`; `total = upload + 10 + model + download`; success requires **total < 300 s**.
Cells give hypothetical completion time; U/G identify the stage where the actual 300 s deadline stops the attempt. P = fits.

| Mbps | PDF MB | Upload s | Model 30 s | Model 90 s | Model 180 s |
|---:|---:|---:|---:|---:|---:|
| 1 | 5 | 40.00 | 80.40 P | 140.40 P | 230.40 P |
| 1 | 20 | 160.00 | 200.40 P | 260.40 P | **350.40 G** |
| 1 | 50 | 400.00 | **440.40 U** | **500.40 U** | **590.40 U** |
| 3 | 5 | 13.33 | 53.47 P | 113.47 P | 203.47 P |
| 3 | 20 | 53.33 | 93.47 P | 153.47 P | 243.47 P |
| 3 | 50 | 133.33 | 173.47 P | 233.47 P | **323.47 G** |
| 10 | 5 | 4.00 | 44.04 P | 104.04 P | 194.04 P |
| 10 | 20 | 16.00 | 56.04 P | 116.04 P | 206.04 P |
| 10 | 50 | 40.00 | 80.04 P | 140.04 P | 230.04 P |

22 fit; five fail (three Uploading, two Generating). No listed combination fails in WaitingForFile/Reading. A much slower download or longer processing could change that; S3 isolates Reading independently. The model-time assumption here means time to non-streaming headers; it is not a provider measurement.

## Ranked recommendations (proposals only; sizes include tests)
1. **(a) Stage-aware stall timeouts plus a larger absolute cap.** Durable recommendation: reset transfer inactivity timers on upload/read progress; keep a separate first-header allowance because model thinking sends no bytes. Illustrative policy: 60 s transfer stall, 480 s first-header grace (covers the 360 s S2 fixture), 900 s absolute cap, separately bounded processing. Tune using measured evidence. All 27 estimates fit that policy; uniformly applying a 60 s no-byte rule would incorrectly reject the 90/180 s model cases.
   Touch `gemini_budget.rs`, `gemini_files.rs` (observable streamed upload body), `gemini.rs`, `gemini_jobs.rs`/`gemini_cancel.rs` deadline persistence/cancellation and slow-link tests. Risk medium/high: accounting, cancellation, persistence, provider costs and misleading socket-write progress. Size ~3–5 engineering days. S1–S3 timeout baselines should become success while bytes move/first-header grace holds; S4 still replays early drops but may now succeed on attempt two; S5 remains success. Add deliberate stalls, first-byte grace, absolute cap and restart/cancel tests.
2. **(d) Larger allowance based on measured upload rate.** Smallest interim change: conservative upload estimate plus processing/model/download reserves and a bounded ceiling; preserve useful stage diagnostics. A 600 s allowance covers this entire table (worst 590.40 s), with little safety margin; S5 directly demonstrates the mechanism. Uploaded bytes/socket-write rate alone can overestimate actual network progress; one fixed increase never distinguishes slow from dead.
   Touch `gemini_budget.rs`, `gemini_files.rs` rate sampling, `gemini.rs`, durable deadline integration in `gemini_jobs.rs`, tests. Risk medium: poor estimates and longer paid waits. Size ~1–2 days for a fixed larger cap, ~2–4 for rate measurement/adaptation. S1–S3 would succeed if estimated allowance covers them; S4 may finish its second request; S5 stays success. Add zero/unstable-rate, ceiling and persisted-budget tests.
3. **(b) `streamGenerateContent?alt=sse`, combined with (a).** Once tokens arrive, progress can keep a stall timer alive; streaming alone under the same 300 s cap does not fix the table's upload/model failures or eliminate initial thinking stalls. Parse SSE incrementally across arbitrary UTF-8/network/event boundaries, decode each response JSON, concatenate one candidate's `parts[].text` in order, then parse the assembled inner schema JSON. Never concatenate whole response envelopes. A split JSON string/document is expected to become parseable only when complete; responseSchema still requires final validation, finish/block/truncation handling and the size limit.
   Compatibility is a protocol-based recommendation using the reviewer-provided SSE facts, not live-provider verification this round. Partial saving needs a distinct incomplete draft/checkpoint, source identity, bounded storage, cancellation/restart semantics and explicit UI; raw fragments must never become a Ready study aid. Preserve final metadata and do not mix candidates.
   Touch `gemini.rs`, `gemini_budget.rs`, `fake_gemini.rs`, `gemini_jobs.rs`, `src/services/gemini.ts` and `src/pages/StudyLibrary/GeminiJobNotice.tsx`, plus parser/checkpoint tests. Risk high: SSE framing, incomplete JSON and misleading resumability. Size ~4–7 days, +2–4 for partial drafts. S3 flips only with the timer change; S2 moves to Reading sooner only if real first tokens arrive sooner; S1 stays an upload issue. Replace S4's replay assertions only if resumability is explicitly added; S5 stays success.
4. **(c) Per-section/chapter requests, save each validated unit.** Reuse `gemini_batches.rs` and the journal/draft machinery already present; current batches still share the active allowance. Smaller requests can reduce model latency/output and preserve completed units. Merely partitioning output does not fix uploading a 50 MB PDF at 1 Mbps; split/select the source too, or adopt (a)/(d). Table gains cannot be quantified without per-unit model/source sizes.
   Touch `gemini_batches.rs`, `gemini.rs`, `gemini_jobs.rs`/draft persistence, `src/services/gemini.ts`, `src/pages/StudyLibrary/MaterialDetail.tsx`, tests. Risk high: duplicate/omitted content, source references, cross-unit coherence, cost and resume identity. Size ~4–8 days. S2/S3 flip only with reduced per-unit latency/body or allowance changes; S1 only with a smaller source. S4 becomes unit retry/checkpoint recovery; S5 remains a control. Add partial-unit restart and no-duplicate-save tests.

## Verification receipts and commands
All logs under `docs/evidence/offline-gen-00-2026-10-20` (E). Receipt runner: `/Users/rickymac/code/.gen-rel-loop/offline/qwen-03b-r4-20261019/receipt.py`; each log contains the actual command/output and final EXIT.
Every Cargo invocation used `env SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk CARGO_TARGET_DIR=/Users/rickymac/code/Flight-training-offline-gen-00/src-tauri/target CARGO_NET_OFFLINE=true`; manifest `src-tauri/Cargo.toml`. Node PATH used `/opt/homebrew/opt/node@22/bin` first.

| Command (after environment prefix for Cargo) | Receipt | EXIT / counts |
|---|---|---|
| `npm run build` | `build.log` | 1; tsc passed, Vite EPERM writing shared node_modules/.vite-temp |
| `npm run build -- --configLoader runner` | `build-runner.log` | 0; tsc and Vite build passed, no shared dependency write |
| `cargo fmt --manifest-path src-tauri/Cargo.toml` | formatting preparation | 0 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml gemini` | `cargo-gemini.log` | 0; 200 passed, 0 failed, 1 ignored, 633 unit tests filtered |
| `cargo test --locked --no-fail-fast --manifest-path src-tauri/Cargo.toml` | `cargo-full.log` | 0; 823 unit + 13 service + 15 worker = 851 passed; 0 failed; 11 ignored |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml gemini::slowlink_tests -- --nocapture` | `slowlink.log` | 0; 7 passed, 0 failed, 827 unit tests filtered; nine measurements above |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | `fmt.log` | 0; format clean |
| `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | `clippy.log` | 0; no warnings |
| `python3 -c <arithmetic printed verbatim in receipt>` | `estimates.log` | 0; 27 combinations, 22 fit, 5 fail |
| `git diff --check` | final workspace check | 0 |

Read-only setup checks (`rev-parse HEAD`, status, dependency link) exited 0. An optional process listing (`ps`) was denied by the sandbox (EXIT 127); it was unnecessary and not retried. No test failure needed a repair attempt; the build workaround succeeded on its second focused attempt.
All edits remain uncommitted; the pre-existing `node_modules` symlink is unchanged and unstaged. Build outputs are ignored; evidence `.log` files are also ignored by repository policy but exist locally for review.

## SHA256 of changed source files
| File | SHA256 |
|---|---|
| `src-tauri/src/fake_gemini.rs` | `6d529700a0a44c13864aaae5839b170df0d079f509623e5b69ac3ba9f9ada4c8` |
| `src-tauri/src/gemini.rs` | `cac14aba41aaa9fdf35eda19e0ea9e6ec2e820d3b3a11e4fcf6cea95818aa7a8` |
| `src-tauri/src/gemini_slowlink_tests.rs` | `8671f191560e4b3c780ade2a697ba6e1dbe3a75e1d3ba9404a8e87aad2cf807b` |
`E/SHA256SUMS` hashes these files, this report and every receipt; its own hash is necessarily excluded to avoid self-reference.
