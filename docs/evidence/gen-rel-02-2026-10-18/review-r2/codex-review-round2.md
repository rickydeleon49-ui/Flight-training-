Round 2 remains **RED**. This is a source and receipt review; I did not write files, run builds/tests, launch the app, contact Gemini, or merge.

R1–R8 verification:

| Finding | Status | Reason |
|---|---|---|
| R1 | **Fixed** | `Journal::commit` persists before publishing memory changes. A failed `begin` cannot leave a running record. The regression tests the subsequent request without restarting. |
| R2 | **Fixed** | Checkpoint errors propagate through `settle`; `abandon` releases the lock. The returned answer explicitly has `checkpointed: false`, and save-failure messaging explains the restart limitation. |
| R3 | **Not fixed completely** | Native acknowledgement is now retryable, and content equality plus `baseRevision` protects the tested cases. Frontend acknowledgement errors remain hidden, retries depend on unrelated activity, and no applied operation identity is stored transactionally. See R9. |
| R4 | **Not fixed completely** | Subscribe-before-snapshot, final reconciliation and polling address the original missed-event sequences. Concurrent reconciliations can still overwrite newer frontend state. See R12. |
| R5 | **Fixed** | `RunningJob::drop` emits the failure transition; recovered running jobs also have polling reconciliation. The native regression asserts notification. |
| R6 | **Fixed for the reported sequence** | Native `WAITING` protects the same material/output, and frontend starts wait for successful recovery. A separate capacity path still evicts waiting answers; see R10. |
| R7 | **Fixed for the reported queued-write sequence** | Material identity, path, fingerprint and revision checks now execute inside `mutate`. The added test changes bytes while an earlier mutation holds the queue. |
| R8 | **Not fixed completely** | Successful startup cleanup clears jobs, but invalidation occurs after restore has completed and removed its recovery markers. A crash in between bypasses cleanup on the next launch. See R11. |

New and remaining findings follow. Reproductions below are source-derived, not executed.

1. **GENREL02-R9 — blocking: acknowledgement failure remains invisible and can resurrect discarded work.**

   **Location:** `src/state/GeminiJobs.tsx:204`, `:216`, `:544`.

   **Reproduction:** Recover a ready answer, obstruct journal writes, then discard it. `forget` immediately removes its controls; `flushAcks` catches the persistence error without displaying it. With no recovered running job, no timer retries the acknowledgement. Restore journal writability and leave the app idle: nothing retries. Closing and reopening brings the discarded answer back. Before restarting, another request for that output receives native `WAITING`, despite the save/discard controls having disappeared.

   The regression supplies an extra change event to trigger retry; an acknowledgement failure does not itself produce that event.

   **Required fix:** Retain visible pending acknowledgement state, explain failure and provide reliable retry. Store an applied job identity with the content transaction so recovery does not depend solely on current content equality or timestamps. Test acknowledgement failure without an injected event, discarded-work recovery, and termination between content commit and acknowledgement.

2. **GENREL02-R10 — blocking: the capacity limit silently deletes waiting checkpoints.**

   **Location:** `src-tauri/src/gemini_jobs.rs:226`.

   **Reproduction:** Keep eight ready answers for different material/output pairs, then request a ninth. `begin` chooses a victim even when every record is `Ready`, removes the oldest answer and persists the replacement. No deliberate discard occurred; that answer is lost after restart.

   **Required fix:** Evict only disposable failed/interrupted records. When all slots contain protected checkpoints, refuse the new request with an actionable message before contacting Gemini. Test a journal containing eight ready answers.

3. **GENREL02-R11 — blocking: restore invalidation is outside the durable restore lifecycle.**

   **Location:** `src-tauri/src/lib.rs:168`; `src-tauri/src/gemini_jobs.rs:322`. Relevant existing restore behavior: `src-tauri/src/backup.rs:7180`.

   **Reproduction:** Leave a ready checkpoint and restore a backup with matching material ID, path, bytes and base content revision. Terminate after restore installation and recovery-marker cleanup, but before `clear_after_restore`. On the next launch, restore reports normal startup, so job invalidation is skipped. The old checkpoint passes the implemented binding checks and can replace restored content.

   There is also a failure fallback that ignores journal deletion errors, allowing the old disk journal to survive another restart.

   **Required fix:** Make invalidation part of the durable restore lifecycle, before removing restore recovery markers, or use a durable library incarnation checked during saves. Failed invalidation must remain recoverable across launches. Test interruption at this boundary and failed journal rewrite/deletion.

4. **GENREL02-R12 — blocking: asynchronous reconciliation can overwrite newer jobs or resurrect dismissed ones.**

   **Location:** `src/state/GeminiJobs.tsx:424`, `:454`, `:488`.

   **Reproduction:** During recovery, let an event-triggered reconciliation capture an empty `jobsRef`, then pause its `savedContent` read for an unseen ready record. Allow initial recovery and its final reconciliation to finish. Discard that recovered record and start another job. Resume the paused read: its unconditional `commit(next)` republishes the old snapshot, resurrecting the discarded record and dropping the new local job from frontend state. Subsequent updates and `persist` for the dropped local key cannot find it.

   **Required fix:** Serialize reconciliations and reject stale snapshots, or merge into current state after asynchronous reads with operation/version checks. Recheck pending acknowledgements after awaits. Add a deterministic test covering concurrent recovery, discard and a new start.

5. **GENREL02-R13 — blocking: omitting material identity bypasses native job exclusion.**

   **Location:** `src-tauri/src/gemini.rs:920`.

   **Reproduction:** While a recorded job is running, invoke either generation command without `materialId`. The `None` branch skips `Journal::begin`, including its `BUSY` check, and awaits provider work. Multiple identity-less requests likewise run concurrently. The existing `a_generation_without_a_material_is_not_recorded` test explicitly preserves this bypass.

   **Required fix:** Require material identity for these commands, or enforce native concurrency independently of journal registration. Test recorded and identity-less concurrent requests in both orderings.

The source otherwise establishes app-level ownership, queued source checks, checkpoint-based save retries without another generation call, honest interruption handling and drop notification. The backup archive allowlist excludes the journal. I found no dependency, migration, version, release, GEN-REL-03 retry-policy or GEN-REL-04 cancel-UI changes.

All **26** entries in the evidence `SHA256SUMS` match. Corrected receipts report **3,670 frontend tests passed, six skipped; 607 native tests passed, six ignored**, plus successful typecheck, build, Clippy, formatting, schema helper and protected-path checks. These receipts do not prove the failure sequences above or installed-app behavior.

Reviewed identity: `/Users/rickymac/code/Flight-training-gen-rel-02`, branch `claude/gen-rel-02`, HEAD/base `36c5d4867e68831a5bac529730be625bc0da0a19`; implementation remains uncommitted.

Recorded SHA-256 hashes:

```text
217a7f4b834ad08c3622b9ac2bb534ada31aea70c6dc69106f7a3255b3e2885d  reliability plan
915fd4caee11b975a6811e6942ecfc881c5e6032b84a52b4fd3f92e185f96e53  implementation report
6431803a835d1f3ab7aa1e63da2b2e1c1d6fd5b7267f4113ef876fabcc01689c  src-tauri/src/gemini.rs
d1be0ff0767f3140423882a563dee7384dea3b34c97e4c93d8114ca54851d71a  src-tauri/src/gemini_jobs.rs
a9d248eee837bebd57ddb43e4286771d40f5b7b24846a1874310a510cc229ed1  src/state/GeminiJobs.tsx
fb5db0e3c6e107272c974d7eb1826a54bec062f5c816dc0697aaf6bdd7cc754c  evidence/SHA256SUMS
2353f6eaa036caf82a6d3198893c35d290c167ecdc4ea44ecc4869d4ef0f48de  source manifest
```

The source-manifest digest covers all 17 modified/untracked files outside `docs/evidence/`, sorted by path and encoded as `SHA256  path\n`.

VERDICT: RED