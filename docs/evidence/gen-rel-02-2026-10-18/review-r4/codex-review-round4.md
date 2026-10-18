Round 4 has **one blocking finding**. This was a read-only source, test, and receipt review. I did not run builds/tests, launch the app, contact Gemini, or merge.

| Previous finding | Status | Verification |
|---|---|---|
| R1 | Fixed | Journal changes persist before publication; failed `begin` leaves no running lock. |
| R2 | Fixed | Failed checkpoint persistence releases the job and returns an explicitly non-durable answer. |
| R3 | Fixed | Content equality prevents duplicate saves; `baseRevision` rejects replacement of newer content. The report’s whole-content idempotency decision remains acceptable. |
| R4 | Fixed | Subscription precedes recovery; final reconciliation and polling cover missed completion events. |
| R5 | Fixed | Dropped work records failure and emits notification, including when persistence fails. |
| R6 | Fixed | Successful recovery gates frontend starts; native `WAITING` prevents replacing a waiting answer. |
| R7 | Fixed for the reported sequence | Material, path, fingerprint, and revision checks execute inside the mutation queue. |
| R8 | Fixed | Restore cleanup invalidates old jobs; failed cleanup quarantines them. |
| R9 | Fixed | Failed discard stays visible; saved-job acknowledgements retry on a timer; forgotten IDs suppress resurrection. |
| R10 | Fixed | Capacity eviction selects only failed/interrupted records; protected checkpoints cause `FULL`. |
| R11 | Fixed | Restore markers remain until job invalidation succeeds; quarantine protects launches where cleanup fails. |
| R12 | Fixed for the reported sequence | Reconciliation runs serially and merges against current state after asynchronous reads. |
| R13 | Fixed | Both native generation commands require material identity and pass through journal exclusion. |
| R14 | Fixed | Journals opened beside a restore marker, or whose clearing fails, offer no jobs and refuse new starts. Successful clearing lifts quarantine. |

**GENREL02-R15 — blocking: deleted materials leave inaccessible checkpoints that can permanently fill the journal.**

**Locations:** [GeminiJobs.tsx:316](/Users/rickymac/code/Flight-training-gen-rel-02/src/state/GeminiJobs.tsx:316), [MaterialDetail.tsx:196](/Users/rickymac/code/Flight-training-gen-rel-02/src/pages/StudyLibrary/MaterialDetail.tsx:196), [gemini_jobs.rs:241](/Users/rickymac/code/Flight-training-gen-rel-02/src-tauri/src/gemini_jobs.rs:241).

**Reproduction, derived from source:**

1. Start generation for material A, then delete A while generation runs. The Delete control permits this.
2. Gemini finishes and checkpoints its answer. The queued save correctly refuses the deleted target, leaving the frontend job `superseded` and the native record `Ready`.
3. No reachable screen exposes that job’s notice or Dismiss control. Job notices appear only on their material’s detail page, which returns “Material not found” before rendering them.
4. Restart preserves the orphaned checkpoint as a recovered answer, still without reachable controls.
5. Repeat for eight materials. Every slot now contains a protected `Ready` record. All subsequent generation receives `FULL`, whose instruction to save or discard an answer cannot be followed.

The existing deletion regression verifies no save and lock release, but does not verify an honest notice, dismissal, or eventual capacity recovery.

**Required fix:** Provide reachable app-level controls for orphaned jobs, including deliberate discard with acknowledgement-failure handling. Show the source-deletion outcome outside the deleted material’s page. Add coverage for deletion during generation, restart with orphaned ready answers, and freeing capacity through the UI.

**GENREL02-R16 — non-blocking: the writer does not enforce the journal’s total serialized-size bound.**

**Locations:** [gemini_jobs.rs:281](/Users/rickymac/code/Flight-training-gen-rel-02/src-tauri/src/gemini_jobs.rs:281), [gemini_jobs.rs:373](/Users/rickymac/code/Flight-training-gen-rel-02/src-tauri/src/gemini_jobs.rs:373), [gemini_jobs.rs:387](/Users/rickymac/code/Flight-training-gen-rel-02/src-tauri/src/gemini_jobs.rs:387).

**Reproduction, derived from source:** Record eight synthetic answers whose serialized sizes are each exactly 2 MiB. Each passes the answer bound, but their results alone total 16 MiB; journal metadata pushes the file above `MAX_JOURNAL_BYTES`. Writing succeeds. Reopening then treats the implementation’s own journal as oversized and sets aside every checkpoint.

**Required fix:** Check the complete serialized journal before replacing the existing file, preserving earlier checkpoints when the new state exceeds the bound. Add a near-limit round-trip regression.

This is non-blocking because the current 8,192-token generation limit makes this boundary unlikely in ordinary operation; it remains a gap in the stated durable-format contract.

All **49 evidence checksum entries match**. Current `review-r3/01…10` receipts report **3,673 frontend tests passed, six skipped; 612 native tests passed, six ignored**, plus successful typecheck, build, strict Clippy, formatting, lock, helper, and protected-path checks. My read-only `git diff --check` passed. Live-provider and installed-Mac behavior remain **UNVERIFIED**.

The archive allowlist excludes the journal. No migration, dependency, version, release, GEN-REL-03 policy, or GEN-REL-04 cancellation changes were found.

Reviewed identity: `/Users/rickymac/code/Flight-training-gen-rel-02`, branch `claude/gen-rel-02`, HEAD/base `36c5d4867e68831a5bac529730be625bc0da0a19`; implementation remains uncommitted.

Recorded SHA-256 hashes:

```text
217a7f4b834ad08c3622b9ac2bb534ada31aea70c6dc69106f7a3255b3e2885d  reliability plan
70493e5eacf43410507fa8c042f0b42bd484aee84da33e6e9eb4e3d89c02fa7e  implementation report
da460dc874791148b272c0d669a256a7d69393f2adadf83b0268e4497cddd4bc  src-tauri/src/backup.rs
8686bc4760b879bb1c50b2e584f93b75810c52db953ada4dbb07c1564c79412d  src-tauri/src/gemini.rs
6a69dcb22d283a8a92728ad19008d2ea5a9d81e797f0fbeeef7bf0926bd33931  src-tauri/src/gemini_jobs.rs
15faf3a72a599e9ded806e060de9d2131b927f43c70d075c71290ce382fec18f  src/state/GeminiJobs.tsx
5b8f8b04a1af8b945884cabbae66d5e518e76e06d1fb0b3580ab578a4b84f0c9  MaterialDetail.tsx
affce802f308592b17dbae4c5f50460c30376963f1e228ddd8cd569f90d8d89f  evidence/SHA256SUMS
a6d549d6c55f164e941bc1a66966de89d3cd73ce3de8afa7089b151be776ebba  source manifest
```

The source-manifest digest covers all 18 modified/untracked files outside `docs/evidence/`, sorted by path and encoded as `SHA256  path\n`.

VERDICT: RED