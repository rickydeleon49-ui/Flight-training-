# Claude: independently review GEN-REL-05 and GENREL04-R12

Review the uncommitted implementation in `/Users/rickymac/code/Flight-training-gen-rel-05`, base `3d50a64976da1c4ab5afca72edaa73f02802d4a6`. Read `CLAUDE.md`, `PRODUCT_SPEC.md`, the GEN-REL-05 plan section and `docs/GEN_REL_05_IMPLEMENTATION_REPORT_2026-10-19.md` first. Review round 1 findings R1–R4 have been corrected. Read the implementation report's "Review round 1 corrections" section and the preserved Claude review. The schema helper is known to fail process enumeration in this sandbox; Claude independently reported 26/26 outside it. Do not call the sandbox gate all-green. This prompt supersedes the earlier incomplete BLOCKED assignment; the original reports and all failed receipts remain under `docs/evidence/gen-rel-05-2026-10-19/`.

You are the independent reviewer, not the implementer. Inspect the entire diff and the new untracked `src-tauri/src/gemini_batches.rs`; `git diff` alone omits untracked files. Do not commit, push, merge, launch the app, use a real key/profile, or call a real provider. Use only synthetic fixtures and loopback HTTP. Preserve dirty work and all evidence. Do not modify STATUS.md, ROADMAP.md, PROJECT_HANDOFF.md, shipped migrations or the schema-14 manifest. The coordinator owns integration after GREEN review and green exact-head CI.

Pay particular attention to these acceptance boundaries:

1. Both new generation and regeneration offer 20/40/60 with 40 default, as a maximum, while practice question counts remain unchanged. Counts must describe checked/kept cards honestly, including short and unsupported sources.
2. One guide plus up to six ten-card units, never a sixty-card combined answer. Same selected source bytes/hash/page identity in every unit; PDF uploaded once in normal runs and always referenced, never inline. Re-read source identity before and after each unit. Validate card text and PDF page references before checkpointing.
3. Nine generation submissions maximum, including two shared recovery submissions and at most three submissions per unit. Planned calls must not consume recovery allowance. Every reservation is persisted before dispatch and survives cancellation/restart. Review the conservative 512-admission transport backstop, including preparation, polls, missing-file recovery and generation-owned DELETEs; no request may evade journal admission.
4. The same monotonic 300-second active budget spans all units; a persisted deadline shortens resumed work rather than granting another five minutes. The implementation conservatively charges closed-app time too. Check that exhausted budgets/caps retain an honest draft and are never represented as a complete answer or a user cancellation.
5. Exact normalized question/answer pairs are deduplicated across batches without changing the first accepted order. Output is bounded by guide/card token caps, a streaming 1 MiB response cap and field/card limits. Examine malformed, truncated, repeated and invalid-page responses.
6. Journal `draft` must remain distinct from publishable `result`. A checked unit checkpoints before the next; completion/source-exhaustion markers prevent replay. Matching deliberate Try again carries draft identity and ledger; changed file/hash/base revision or target refuses. No automatic restart call. Failed/cancelled drafts must not be acknowledged or evicted silently.
7. Cancellation must still win under the existing journal lock, before every send and DELETE. Review R12's drop guard: only unsent remote copies return to `orphaned`; the in-flight DELETE's uncertain result must never cause a duplicate cleanup. Review both held-DELETE `Cancellable` regressions.
8. Completed sets wait for explicit Save. No incremental live append, reordered existing cards or reassigned progress. Save again uses only the checkpoint; a failed final save retains old content, card versions and immutable review history. A failed final native journal write must retain its prior draft rather than erasing it.

Use the report's acceptance map to inspect named tests. New native batch coverage is `gemini::batches::tests` (thirteen tests); frontend coverage is added to `MaterialDetailSourceChoice.test.ts` and `MaterialDetailJobs.test.ts`. Existing recovery/cancellation/final-save guards remain part of acceptance. Captured fixture measurements: one 427-byte upload for all targets; 3/5/7 generation requests and 7/11/15 total HTTP calls normally; nine generation requests and seventeen total HTTP calls for sixty cards with two retries. Verify these are test measurements, not live-quality claims.

Current correction receipts are `round1-final-gate-results.json`, `round1-final-*.log`, `round1-native-focused-expanded.log`, `round1-frontend-focused.log` and the `round1-*` source manifests/patch. Pre-fix red receipts are retained. Check `current-gate-summary.json`; the following earlier receipts are historical: `corrected-typecheck.log`, `corrected-frontend-tests.log`, `final-gate-results.json`, `final-*.log`, `batches-final-focused.log`, R12's network-enabled receipt, final source manifest and SHA256SUMS. Historical `gate-results.json`, `schema14.log` and earlier BLOCKED notes are not current gate results. Failed development receipts are deliberately retained. If the schema helper encounters generated build diagnostics, remove only identified regenerable output and keep the first failure; never edit its frozen manifest to make it pass.

Validation commands (Node 22 PATH; SDKROOT only for Cargo):

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run typecheck
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk cargo test --locked --manifest-path src-tauri/Cargo.toml
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:cargo-lock
PATH=/opt/homebrew/opt/node@22/bin:$PATH node --test scripts/mac-schema14-profile-snapshot.test.mjs
git diff --check
```

No dependency or version change and no migration is authorized. Rust MSRV is 1.77.2. Live provider output quality/duration and installed-Mac behavior remain UNVERIFIED; source tests cannot establish them.

Return GREEN only if the whole feature and carried-over fix satisfy the contract. Otherwise provide numbered findings with severity, exact file/line, concrete reproduction, expected/observed behavior and the smallest appropriate correction. Distinguish blocking defects from non-blocking limitations and fixture mistakes. Do not implement fixes during the review. End with an explicit GREEN or CHANGES REQUIRED recommendation and list the checks you independently ran.
