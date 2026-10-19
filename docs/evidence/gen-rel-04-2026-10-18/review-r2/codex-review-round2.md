Read-only review completed. No files were written and no tests were rerun. Corrected receipts report 3,690 frontend tests and 660 native tests passing; those results do not cover the races below.

Round-1 verification:

- **GENREL04-R1 — fixed for the reported registration race.** `gemini.rs:1131–1145` registers the token, rereads cancellation under the journal lock, then calls `started`. A cancellation before registration is detected; a later cancellation can wake the token. The announcement-hook regression exercises the original failure.
- **GENREL04-R2 — fixed.** `GeminiJobs.tsx:514–520` checks cancellation after listener setup, immediately before invocation. Both listener success and rejection are covered.
- **GENREL04-R3 — fixed for missing progress delivery.** Generation and cancellation share a frontend-created `requestId`. Native cancellation finds the running request or holds cancellation before `begin_request`; neither depends on progress delivery.
- **GENREL04-R4 — not fully fixed.** Terminal classification now uses the native cancellation error, rejected cancels restore the button, and any answer following a cancel attempt requires deliberate saving. However, `GeminiJobs.tsx:400` still discards every resolved cancellation outcome. An unsuccessful outcome with neither a terminal stage nor `pending` leaves the button disabled and displays “Cancelling…” without an accepted cancellation. Consume the outcome and restore actionable failure state when cancellation was neither recorded nor held. The added failed-stage test verifies later generation rejection, not handling of the cancellation outcome itself.

New findings:

1. **GENREL04-R5 — blocking — `src-tauri/src/gemini_cancel.rs:77`; `src-tauri/src/gemini.rs:1639–1648`**

   **Trigger:** Cancellation lands while `inner.poll()` is executing. `Cancellable` checks its token only before entering that poll. The inner future can cross multiple immediately ready awaits, reach another stage and start another request before returning control.

   A deterministic regression can cancel synchronously from the `Generating` stage observer: the journal records cancellation and the token is cancelled, but `generate_once` proceeds directly into `.send().await`. Waking the outer future does not interrupt its current poll.

   **Required fix:** Enforce cancellation at request and publication boundaries within the work, with submission ordered against cancellation where necessary. Add deterministic observer/barrier tests proving that cancellation recorded before the next submission prevents that submission. Checking the token only around the whole future is insufficient.

2. **GENREL04-R6 — blocking — `src-tauri/src/gemini_jobs.rs:475–480`; `src-tauri/src/gemini.rs:1185–1189`**

   **Trigger:** A cancelled journal entry disappears before its owning command settles. Cancelled entries can immediately be acknowledged, replaced by another request for the same material/kind, or evicted. Meanwhile, a just-completed inner poll can still return `Ok(answer)`.

   `settle` treats a missing entry as success. `RunningJob::finish` then returns `Ok(None)`, and `as_job_with` hands the answer over as an uncheckpointed success. The cancellation decision has been erased. In a window that did not initiate that cancellation, the normal success path can automatically save the answer.

   The same removal also undermines the registration reread: an entry cancelled and removed between `begin_request` and that reread appears uncancelled.

   **Required fix:** Preserve the authoritative cancellation decision until the owning operation has finished, including across acknowledgement, replacement and eviction. A missing record must not authorize successful handoff. Add regressions cancelling and removing/replacing the entry before registration and immediately before settlement; neither may poll new work or return an answer.

GENREL03-R1 records the received status before HTTP-status early returns and assigns `CheckingFile` before the request. Local-job recovery exemptions, polite live status, keyboard-reachable Cancel, confirmation-based Try again and guard cleanup are present. No migration, dependency, version, release or GEN-REL-05 changes were found. Live-provider and installed WKWebView behavior remain unverified.

VERDICT: RED