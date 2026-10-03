# A6 truthful Gemini retry wording — implementation report, 2 October 2026

Implements audit finding A6 ([audit](FULL_REPOSITORY_AUDIT_2026-09-29.md#a6--p2-geminis-reported-retry-duration-omits-request-time)) from [Claude's A6 prompt](CLAUDE_MAC_A6_RETRY_WORDING_PROMPT_2026-10-02.md). This is a native wording and context correction with pure message-contract tests. It is the implementer's report and **not Codex acceptance**.

## Identity and ownership

- **Task / date / roles:** A6 retry wording, 2 October 2026. Implementer: Claude (Mac). Independent reviewer and Git coordinator: Codex.
- **Machine / toolchain:**
  - MacBook Air (Mac17,3), Apple M5, 32 GB.
  - **macOS 27.0.1 (26A434).** This Mac was updated since the earlier reports, which recorded 26.6.
  - Node 22.23.3 / npm 10.9.9 and rustc 1.99.0 via scoped `PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH`.
  - `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`, still present and still sufficient.
- **Prerequisite:** PR #49 (A4) merged as `db1539408368aa48260228029590ab19a4748f4d`; `docs/MAC_A4_OFFLINE_STUDY_ACCEPTANCE_2026-10-02.md` is present. The previous A4 checkout was clean.
- **Branch / base:** `codex/mac-gemini-retry-wording-a6` (upstream unset), created from clean `main` fast-forwarded to `db1539408368aa48260228029590ab19a4748f4d`. No `*a6*`/`*retry*` branch existed locally or on GitHub.
- **Code availability:** LOCAL UNCOMMITTED. Nothing committed or pushed.
- **Other owners:** A2 remains with its Windows owner; none of its boundaries were touched.

## Call contexts inspected (`src-tauri/src/gemini.rs`)

| Caller | What actually happened before the message | Message used before | Message used now |
| --- | --- | --- | --- |
| `generate_with_retries`, end, primary never rate-limited | The main model was asked `MAX_ATTEMPTS` (4) times with growing pauses (1.5 / 3 / 6 s plus up to 25% jitter), then the backup model once. Each request can take up to `GENERATE_TIMEOUT` (300 s). | `busy_message()`: "…tried 4 times **over about 11 seconds** and then tried the backup Flash-Lite model…" | `busy_message()`: "…asked the main model 4 times, pausing between attempts, and then tried the backup Flash-Lite model, and Google was still at capacity…" (no duration) |
| `generate_with_retries`, end, primary rate-limited; or backup returned 429 | Retries plus backup, ending on a rate limit | `rate_limit_message()`: "…retried briefly and tried its backup model…" | Unchanged (true in these contexts) |
| `generate_with_retries`, non-retryable refusal (primary or backup) | One refusal that is not retryable; `describe_refusal` gets 400/401/403/404/other | `describe_refusal` (429/5xx arms unreachable here) | Unchanged |
| `verify_key` (connection check), final 429 | The primary model only, up to 4 requests; **never the backup** | `describe_refusal(Verification, 429)` → `rate_limit_message()`: "…retried briefly and **tried its backup model**…" (false) | `rate_limited_now_message(Verification)`: "Gemini's rate or spending limit was reached for this project, so the key could not be checked. Check the project's limits and billing in Google AI Studio, or wait and try again." |
| `verify_key`, final 500–504 | Same: primary only, no backup | `describe_refusal(Verification, 5xx)` → `busy_message()`: "…tried 4 times over about 11 seconds and then **tried the backup Flash-Lite model**…" (false) | `busy_now_message(Verification)`: "Google's servers are busy, so the key could not be checked right now. This is Google's side, not necessarily your key — try connecting again in a few minutes." |
| Any other `describe_refusal(Generation, 429/5xx)` | One response with no retry history known to the function | Retry-history wording | `rate_limited_now_message` / `busy_now_message(Generation)`: generic, no attempts, backup or duration claimed |
| `waiting_message` (each pause) | Describes the **upcoming** pause (including jitter, rounded up) and the upcoming attempt number | "Waiting N seconds, then trying again — attempt K of 4." | Unchanged; already truthful about the next pause, not total duration |

`total_wait_seconds()` existed only for the removed claim and is deleted. Distinct guidance for invalid keys, 400 (by context), 401, 403 and retired models (404) is unchanged.

**Unchanged:**
- retry policy: `MAX_ATTEMPTS`, backoff and jitter, the cap, `VERIFY_TIMEOUT` / `GENERATE_TIMEOUT`, `is_retryable` and backup selection
- progress events and cancellation behavior
- request payloads, models and API-key handling
- explicit submission and the UI operation lock

## Issue-to-fix map

| Issue | Fix | Maintained regressions (`gemini::tests`) |
| --- | --- | --- |
| A6: the final busy text claimed an elapsed duration computed from nominal pauses only. The real wait includes request time (up to 300 s each across 5 requests), jitter and the backup request. | Duration removed from `busy_message()`; it now states only what was asked. `total_wait_seconds()` removed. | `a6_the_exhausted_busy_message_makes_no_elapsed_time_claim` |
| Connection-check (and any single-response) 429/5xx reused generation's retry-history text, claiming a backup model and 4 generation attempts | `describe_refusal` now uses context-aware messages with no retry history (`rate_limited_now_message`, `busy_now_message`). Generation's exhausted outcomes keep their history-bearing messages, which are true there. | `a6_connection_check_refusals_do_not_claim_a_backup_model_or_retry_count` · `a6_a_single_refusal_without_retry_context_stays_generic` |
| Exhausted generation must still say what actually happened | The history-bearing messages are kept for the exhausted paths | `a6_the_exhausted_messages_still_say_what_generation_actually_tried` (guard) |

The tests check the message contract: no duration or "over about", no "tried", "retried", "backup", "Flash-Lite" or "4 times" where no such history exists, and the expected guidance keywords are present. They don't pin every word. Existing classification and backoff tests are kept. `the_busy_message_blames_google_and_says_how_long_it_tried` lost its `total_wait_seconds` assertion along with the helper and is renamed `the_busy_message_blames_google_not_the_key`; its other checks are unchanged. No network, sleeps or live Gemini.

## Negative controls

- **Before the fix:** the four tests added to `db15394`'s `gemini.rs` gave `cargo test … gemini::tests` exit 101, **27 passed / 3 failed** (the three claim tests); the guard passed.
- **Reproducible control after the fix:** `db15394` production code plus the current test module (swapped in, then restored and verified by SHA-256) gave the same **3 failed / 27 passed**. The failures print the old texts: "…tried 4 times over about 11 seconds…" for exhausted generation, and "…retried briefly and tried its backup model…" for a connection-check 429.

[Sanitized receipt](evidence/mac-a6-retry-wording-2026-10-02/regressions-and-negative-control.txt).

## Verification receipts

| Exact command | Tested source | Exit / counts | Shared summary |
| --- | --- | --- | --- |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml gemini::tests` | Original production code plus new tests | **101**; 27 passed / 3 failed | [regressions-and-negative-control.txt](evidence/mac-a6-retry-wording-2026-10-02/regressions-and-negative-control.txt) |
| Same | Corrected | 0; 30 passed | same |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` (development) | Corrected | 1 → `cargo fmt` applied (re-wrapped one test assertion) → 0 | same |
| **Final gate:** `npm ci` | Corrected diff | 0; 165 packages, 0 vulnerabilities | [local-gate-summary.txt](evidence/mac-a6-retry-wording-2026-10-02/local-gate-summary.txt) |
| `npm test` | same | 0; 66 files passed / 3 skipped; 666 passed / 4 skipped (no frontend change) | same |
| `npm run build` | same | 0 | same |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | same | 0 | same |
| `SDKROOT=…26.5.sdk cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | same | 0 | same |
| `SDKROOT=… cargo test --locked --manifest-path src-tauri/Cargo.toml` | same | 0; **250 passed** (246 plus 4), 6 ignored; all 4 `a6_` tests ok | same |
| `npm run test:cargo-lock` | same | 0 | same |
| `git diff --check` plus an untracked-file whitespace scan | same | 0; clean | same |

The gate ran once, sequentially, after the final change. No benchmark or installer was rebuilt. Raw logs are local under `.smoke/mac-a6-retry/gate/`.

## Changed files and hashes (SHA-256)

```text
41ba366b27a1aedca2318fd389ba2ae0d99909ab2e051a5c2e75488e4667fa71  src-tauri/src/gemini.rs   (base 12f2116c…)
```

Plus this report, `docs/evidence/mac-a6-retry-wording-2026-10-02/` (hashes in its README), `STATUS.md`, `docs/PROJECT_HANDOFF.md` and `docs/MAC_PARITY_CHECKLIST.md`. No frontend, dependency, lockfile, migration, model, payload or configuration change.

## Limits

- Message contracts are unit-tested. No live Gemini request, installed app, real network failure or VoiceOver reading was exercised.
- The progress text (`waiting_message`) still names the next pause, which is accurate. Total operation time is deliberately not reported anywhere.
- The OS on this Mac changed to macOS 27.0.1. Source tests and the native build pass with explicit SDK 26.5; earlier installed or packaging evidence (DMG, signing assessment) belongs to the earlier OS and was not repeated.
- **Unchanged:** macOS 12 / Windows support, backup v3 and v1/v2 restore, release holds and the frozen v0.5.3 candidate. No installed launch, DMG, signing or account change.

## Remaining-foundation checkpoint (after A6, if accepted)

| Item | State |
| --- | --- |
| A1 restore retention | Merged (PR #42) |
| A2 atomic material saves | **Open**: Windows-local with its owner; unavailable to the Mac until reviewed source is shared |
| A3 WebKit compatibility | Merged (PR #48); installed macOS 12 and current-macOS checks open (MAC-03) |
| A4 offline saved study | Merged (PR #49); installed offline check open (MAC-19) |
| A5 Mac fixture and verification kit | **Open**: incompressible/distinguishable image fixture, page IDs, a fail-closed archive credential check, and honest memory wording |
| A6 retry wording | This change, local and pending review |
| Installed readiness | Blocked on a dedicated test account and an acceptable signing state |

**Recommended next scoped task (not started):** A5. It is Mac-doable and limited to the test kit. Correct `scripts/generate-pdf-fixtures.mjs` to emit deterministic, incompressible, distinguishable image data and visible page IDs. Re-measure and re-hash the fixtures. Replace the `unzip | grep && … || PASS` credential check with a fail-closed check that has distinct found / absent / error outcomes and prints no secrets, with tests for missing, unreadable and malformed archives. Fix the memory wording. It doesn't touch A2's production boundaries, and it makes the later installed smoke evidence trustworthy. Open-source adoption stays conditional (no MiniSearch, virtualization, Zod/react-markdown or EmbedPDF), and M2, import, the embedded reader and iOS remain gated.

Leave uncommitted for Codex review.
