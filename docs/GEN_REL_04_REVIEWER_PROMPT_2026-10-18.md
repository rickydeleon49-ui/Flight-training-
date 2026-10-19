# Independent review: GEN-REL-04 (honest progress, Cancel, stage-appropriate Retry)

Review the uncommitted GEN-REL-04 implementation against the GEN-REL-04 section of `docs/GENERATION_RELIABILITY_PLAN_2026-10-18.md`, plus the GENREL03-R1 carry-forward. GEN-REL-01–03 are merged and are not under review, except where this package touches them. Do not start GEN-REL-05.

- Worktree `/Users/rickymac/code/Flight-training-gen-rel-04`, branch `claude/gen-rel-04`, base main 49ac022 (PR #215). Uncommitted.
- Report: `docs/GEN_REL_04_IMPLEMENTATION_REPORT_2026-10-18.md`. Evidence: `docs/evidence/gen-rel-04-2026-10-18/`.

## Read

- **Native:**
  - `src-tauri/src/gemini_cancel.rs`: the token, `Cancellable` and the registry;
  - `gemini_jobs.rs`: `JobStage::Cancelled`, `Journal::cancel`, eviction;
  - `gemini.rs`: `Reporter` and `GeminiProgress`, `as_job_with` and `JobHooks`, `cancel_job` and `cancel_gemini_job`, and the command wiring;
  - `gemini_budget.rs`: the stage observer and the `CheckingFile` stage;
  - `gemini_files.rs` `lookup`: GENREL03-R1.
- **Native tests:** `gemini_cancel_flow_tests.rs`, the cancel tests in `gemini_jobs_tests.rs`, and the unit tests in `gemini_cancel.rs`.
- **Frontend:**
  - `src/state/GeminiJobs.tsx`: job-scoped progress, `cancel`, `local` jobs, the race handling and the lock-release render;
  - `src/services/gemini.ts`;
  - `src/pages/StudyLibrary/GeminiJobNotice.tsx`: `GeminiProgressView`, the cancelled notice and Try again;
  - `MaterialDetail.tsx`.
- **Frontend tests:** `MaterialDetailCancel.test.ts`.

## Verify

1. **Completion and cancel are decided atomically.**
   - Only the journal (under its lock, written to disk first) decides.
   - A cancel recorded first means no answer is handed over or saved, even one that had just arrived.
   - A completion first means cancel reports `ready`, and the window offers save or discard and never saves by itself.
   - Look for any path where the window shows "cancelled" while a late save replaces content, or where an answer is written after a cancel.
2. **After a cancel, no new requests and no local writes.**
   - This holds at every boundary: preflight, before the job has an id, upload, file readiness, generation, retry pause, validation and save.
   - The work is dropped through `Cancellable`, and the lease and flight guards still release.
   - Cancel never claims Google did not process or charge for a request already sent.
3. **Progress is honest and scoped.**
   - Events carry `jobId` (once begun), `materialId`, `kind`, the stage reached and the attempt.
   - No percentage. Events for other jobs or materials are ignored.
   - A late event cannot revive a finished job.
   - The live status is `aria-live="polite"`, and Cancel is a real, keyboard-reachable button.
4. **Recovery interplay.**
   - A job this window started, with its id known from progress, must never be treated as one recovered after a reload: `local` jobs are exempt from `reconcile` and the follow timer. Look for another path that confuses them.
   - Restart shows a cancelled job as cancelled and never resends it.
   - Try again goes through the Send confirmation, and a still-valid prepared PDF is reused.
5. **GENREL03-R1.** A file check sets its own stage and records its status before any early return.
6. **Scope:** no migration, dependency, version or release change; no GEN-REL-05 work.

Use Node 22 and `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` if your sandbox allows runs. Synthetic data only.

## Output

Number the findings GENREL04-R1…, each with severity (blocking / non-blocking), file:line, the trigger and the required fix.
