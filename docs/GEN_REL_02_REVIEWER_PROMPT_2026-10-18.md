# Independent review: GEN-REL-02 (recoverable background jobs and checkpoints)

You are the independent reviewer. Review the uncommitted GEN-REL-02 implementation against the GEN-REL-02 section of `docs/GENERATION_RELIABILITY_PLAN_2026-10-18.md`. Do not implement GEN-REL-03 to 05. GEN-REL-01 is merged (PR #212) and is not under review, except where GEN-REL-02 touches it.

## Where it is

- **Worktree:** `/Users/rickymac/code/Flight-training-gen-rel-02`, branch `claude/gen-rel-02`, based on main 36c5d48 (the GEN-REL-01 merge). Everything is uncommitted.
- **Report:** `docs/GEN_REL_02_IMPLEMENTATION_REPORT_2026-10-18.md`, which holds the design, acceptance map, gate and limits.
- **Evidence:** `docs/evidence/gen-rel-02-2026-10-18/`, with `SHA256SUMS`.

## Read

- **Native:** `src-tauri/src/gemini_jobs.rs`, the journal (format, bounds, restart handling). In `src-tauri/src/gemini.rs`: `as_job`, `RunningJob`, `JobAnswer`, the `gemini_jobs` and `acknowledge_gemini_job` commands, and the `generate_*` signatures. Command registration is in `src-tauri/src/lib.rs`.
- **Native tests:** `gemini_jobs_tests.rs`, and the GEN-REL-02 block at the end of `gemini_generation_tests.rs`.
- **Frontend:**
  - `src/state/GeminiJobs.tsx`, the app-wide job store, mounted inside `AppDataProvider` in `src/state/AppDataContext.tsx`;
  - the job wrappers in `src/services/gemini.ts`;
  - `src/pages/StudyLibrary/MaterialDetail.tsx` (the page no longer owns generation) and `GeminiJobNotice.tsx`.
- **Frontend tests:** `MaterialDetailJobs.test.ts` (new), plus the updated assertions in `MaterialDetailGemini.test.ts`, `MaterialDetailOffline.test.ts` and `MaterialDetailSourceChoice.test.ts`. The old rule "a result that arrives after leaving its material is discarded" is replaced by "saved to its own material if unchanged".
- **`README.md`**

## Verify

1. **Ownership survives the page.**
   - Navigation A→B→A and full unmount keep the job observable, and save to the original material only.
   - The shared lock is taken synchronously before any await, holds across the whole app, and is also enforced natively (`BUSY`).
2. **Source binding.**
   - Saving happens only if the material still exists with the same `filePath`, checked inside the `mutate` queue.
   - The stored bytes must still match the `contentSha256` that was sent, where fingerprints are available.
   - A deleted or replaced material, or changed bytes, means no save and an honest notice.
   - Look for any path that writes into the wrong or a changed material, or that weakens a previous stale guard without an equivalent replacement.
3. **Checkpoints.**
   - A validated answer is recorded before the save.
   - "Save again" and a recovered save never call Gemini.
   - Duplicate saves cannot commit twice.
   - Previous saved content and history survive failure.
   - A waiting draft is never overwritten by a new request.
4. **Restart and reload.**
   - `running` becomes `interrupted` on the first open per process and is never resent by itself.
   - `ready` waits for a deliberate save or discard.
   - A still-running job seen after a reload holds the lock until its event.
   - The journal is not reopened mid-process (keyed per root).
   - A late outcome cannot revive an interrupted job.
5. **Durable format and privacy.**
   - Bounded (8 jobs, 2 MB per answer, 16 MB file), written atomically, and an unreadable file is set aside rather than trusted.
   - No key, provider file or URI, upload id, or document bytes in the journal.
   - Not part of backups: check `backup.rs`' archive allowlist.
   - Restore or reset leaves only jobs that the source-binding check then refuses.
6. **Failure honesty.**
   - A dropped or panicked job is marked failed and frees the lock (`RunningJob` drop).
   - Messages are written for her and contain no locators.
   - Check for silent failures in the frontend, for example swallowed promise rejections that hide a real error, or a lock leaked on an exception path.
7. **Scope:**
   - No migration, dependency, version or release change.
   - No GEN-REL-03 retry policy or GEN-REL-04 cancel UI.
   - Interrupted and uncertain outcomes are not described as completed.

## How to run (if your sandbox allows)

Use Node 22 (`PATH=/opt/homebrew/opt/node@22/bin:$PATH`) and `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` for cargo. Use synthetic data only: no app launch, real provider or key.

## Output

Number the findings GENREL02-R1…, each with severity (blocking / non-blocking), file:line, a reproduction and the required fix. Record identity and hashes. Do not merge.
