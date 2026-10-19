Reviewed `claude/gen-rel-04` at base `49ac022`, including uncommitted files. No files written or tests rerun. Read-only `git diff --check` passed.

| Prior finding | Status | Reason |
|---|---|---|
| GENREL04-R1 | Fixed | Token registration and journal reread precede announcement; previously cancelled work is not polled. |
| GENREL04-R2 | Fixed | Cancellation is checked after listener setup, including rejection, immediately before invocation. |
| GENREL04-R3 | Fixed | Request-id cancellation works independently of progress delivery; held cancellation prevents job creation. |
| GENREL04-R4 | Fixed | Failed or unaccepted cancellation restores Cancel and reports the error. Native outcomes determine cancellation; an arriving answer requires deliberate saving after any cancel attempt. |
| GENREL04-R5 | Fixed | Upload, lookup, generation and each generation-owned DELETE consult journal admission. Cancelled results cannot pass settlement. |
| GENREL04-R6 | Fixed | Live jobs resist acknowledgement, replacement and eviction. Settlement reads the authoritative outcome under the journal lock; missing records suppress handoff. |
| GENREL04-R7 | Fixed | Recovered running jobs cancel by native job id. Only local, uninvoked requests use the frontend shortcut. |
| GENREL04-R8 | Fixed | Request admission and cancellation are ordered through the journal lock. |
| GENREL04-R9 | Fixed | Admission no longer depends on token discovery, closing the registration race. |
| GENREL04-R10 | Fixed | Readiness-error cleanup and other generation-owned cleanup use admission. |
| GENREL04-R11 | Fixed | Every DELETE receives its own admission check. Refusal queues the remaining batch when the cleanup future continues running. |

**GENREL04-R12 — non-blocking — [src-tauri/src/gemini_files.rs:858](/Users/rickymac/code/Flight-training-gen-rel-04/src-tauri/src/gemini_files.rs:858), [src-tauri/src/gemini_files.rs:889](/Users/rickymac/code/Flight-training-gen-rel-04/src-tauri/src/gemini_files.rs:889)**

**Trigger:** Cleanup holds multiple retired copies and awaits its first DELETE. Normal cancellation wakes `Cancellable`, which drops the cleanup future. Its local `pending` queue disappears before the admission-refusal branch can requeue it. `finish_admitted` has already removed those entries from `inner.orphaned`, so subsequent cleanup or disconnect cannot find them.

**Required fix:** Preserve unsubmitted entries with a drop guard that returns them to the cache queue. Add a regression cancelling through `Cancellable` while the first DELETE is held, then verify the remaining copy survives for later cleanup. The existing R11 tests deliberately omit token wake and therefore miss this path.

This does **not** block merge: no additional request is sent, saved content remains protected, and provider expiry remains the documented best-effort fallback.

Completion-versus-cancel remains journal-authoritative. Local-job reconciliation and timer exemptions are present. Try again uses Send confirmation; Save again uses the checkpoint. Progress has job identity, stages and attempts, with polite live status and a real Cancel button. GENREL03-R1 records the lookup stage and received HTTP status before status-based early returns.

Round-5 receipts report 3,692 frontend tests and 667 native tests passing, plus successful typecheck, build, Clippy, formatting and protected-path checks. The earlier failed frontend run remains preserved separately. No migration, dependency, version, release or GEN-REL-05 changes were found. Live-provider and installed WKWebView behavior remain unverified.

VERDICT: GREEN