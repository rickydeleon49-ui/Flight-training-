Round 3 has one blocking finding: restore invalidation remains incomplete. This was a read-only source, test, and receipt review. I did not run builds/tests, launch the app, contact Gemini, write files, or merge.

| Previous finding | Status | Verification |
|---|---|---|
| R1 | Fixed | `commit` persists before publishing memory changes; failed `begin` leaves no running lock. |
| R2 | Fixed | Checkpoint failure releases the native lock and returns an explicitly non-durable answer. Save-failure messaging explains the restart limitation. |
| R3 | Fixed for the reported save/replay behavior | Content equality prevents duplicate commits; `baseRevision` refuses replacement of newer content. Native acknowledgement remains retryable. The report’s content-equality decision is sufficient for these whole-content saves; an old checkpoint superseded by newer content is refused. |
| R4 | Fixed | Subscription precedes recovery; final reconciliation and polling cover missed completion events. |
| R5 | Fixed | `RunningJob::drop` records failure and emits notification, including when persistence fails. |
| R6 | Fixed | Recovery gates frontend starts; native `WAITING` protects existing checkpoints. |
| R7 | Fixed for the reported sequence | Material, path, fingerprint, and revision checks execute inside the mutation queue before saving. |
| R8 | **Not fixed completely** | Successful restore cleanup invalidates jobs, but failed invalidation still permits startup. See R14. |
| R9 | Fixed | Failed discard remains visible and blocks replacement; saved-job acknowledgements retry on a timer. Forgotten IDs suppress resurrection by older snapshots. |
| R10 | Fixed | Capacity eviction selects only failed/interrupted records; eight waiting answers cause `FULL`. |
| R11 | **Not fixed completely** | Retaining the restore marker makes cleanup retryable, but does not prevent old checkpoints being used during the current launch. See R14. |
| R12 | Fixed for the reported sequence | Reconciliation merges against current state after slow reads, runs serially, and respects forgotten IDs. |
| R13 | Fixed | Both native commands require material identity; every generation passes through journal exclusion. |

**GENREL02-R14 — blocking: failed restore invalidation still opens the restored library with usable old checkpoints.**

**Locations:** [backup.rs:7032](/Users/rickymac/code/Flight-training-gen-rel-02/src-tauri/src/backup.rs:7032), [backup.rs:7198](/Users/rickymac/code/Flight-training-gen-rel-02/src-tauri/src/backup.rs:7198).

**Reproduction, derived from source:**

1. Keep a ready checkpoint. Restore a backup containing matching material ID, file path, bytes, and base revision.
2. Make both rewriting and deleting the job journal fail while leaving it readable.
3. On the immediate restore path, `forget_gemini_jobs` returns false, but the function still returns `Installed`. On committed-restore recovery, it similarly returns `RestoreCompleted`.
4. Startup continues. The old ready record remains available through the native journal. Deliberately saving it passes the implemented binding checks and replaces restored content.

Keeping the restore marker only schedules another cleanup attempt; it does not protect this launch. The new `a_committed_restore_forgets_gemini_jobs_even_after_an_interruption` test actually expects `RestoreCompleted` while the old checkpoint remains readable, so it preserves this unsafe behavior.

**Required fix:** Prevent normal startup/job recovery when invalidation fails on either restore path, retaining the recovery marker and returning a blocked outcome. Alternatively, enforce a durable invalidation boundary that every job read/save checks. Add regressions proving old checkpoints cannot be offered or applied during failed cleanup, and that startup resumes safely once cleanup succeeds.

The remaining reviewed behavior supports page-independent ownership, original-material saves, checkpoint-only save retries, deliberate recovery, native exclusion, and honest interruption handling. The backup archive allowlist excludes the journal. I found no dependency, migration, version, release, GEN-REL-03 policy, or GEN-REL-04 cancel-UI changes.

All **38 evidence checksum entries match**. Round-2 receipts report **3,673 frontend tests passed, six skipped; 610 native tests passed, six ignored**, with successful typecheck, build, Clippy, formatting, lock, helper, and protected-path checks. `git diff --check` also passed during this review. These receipts do not establish installed-app or live-provider behavior.

Reviewed identity: `/Users/rickymac/code/Flight-training-gen-rel-02`, branch `claude/gen-rel-02`, HEAD/base `36c5d4867e68831a5bac529730be625bc0da0a19`; implementation remains uncommitted.

SHA-256 records:

```text
217a7f4b834ad08c3622b9ac2bb534ada31aea70c6dc69106f7a3255b3e2885d  reliability plan
b2add2cdb5df328a903d4305bb1faca7e515db666ccc49474e32f04a52bdf9c3  implementation report
d2899e9e7bd6979edf9de5369ad8c53e6873c35121aff7958d98b9233dc5c51c  src-tauri/src/backup.rs
8686bc4760b879bb1c50b2e584f93b75810c52db953ada4dbb07c1564c79412d  src-tauri/src/gemini.rs
b8f1b947defdfc6a34c03711f98ed6cc0fddef6f432bc9e446e1b341b0c7784c  src-tauri/src/gemini_jobs.rs
15faf3a72a599e9ded806e060de9d2131b927f43c70d075c71290ce382fec18f  src/state/GeminiJobs.tsx
c1beb0b4e13f83f86b416494c0b8cc698abec76c425cec9857df723aab2b4940  evidence/SHA256SUMS
f5e970e95610e1f27ee0ca1d6d43000c803ebf5815ef36ef87d09eb5bfa6c9ee  source manifest
```

The source-manifest digest covers all 18 modified/untracked files outside `docs/evidence/`, sorted by path and encoded as `SHA256  path\n`.

VERDICT: RED