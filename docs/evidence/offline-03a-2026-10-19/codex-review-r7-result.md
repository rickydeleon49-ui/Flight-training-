# OFFLINE-03a follow-up review: already-absent journal entry

VERDICT: RED for PR head 72f2be2619cd2cb9be509bf8efc55846277ec51d until this correction is verified. This supersedes the local GREEN decision for the related acknowledgement behavior; the new case was reproduced before merge. PR #237 remains draft and unmerged.

P2 — `src/state/GeminiJobs.tsx:316`: false acknowledgement is ambiguous. The native journal (`src-tauri/src/gemini_jobs.rs:574`) returns false both for an entry it cannot remove and an entry already removed (for example by another window). Treating all false results as failure prevents the stale UI job from being discarded, can block another generation for that target, and keeps the checkpoint unnecessarily.

Reproduced: a completed answer is shown, another window removes its journal entry, acknowledgeGeminiJob resolves false and listGeminiJobs resolves []. Discard leaves jobs in ["discard-failed"] instead of []. The independent UI diagnostic fails at that assertion. Log: /Users/rickymac/code/.gen-rel-loop/offline/qwen-03a-r6-20261019/already-absent-diagnostic-confirmed.log. Case: /private/tmp/hfd-03a-r6-review-jzgbv6yq/AlreadyAbsentAcknowledgement.test.ts, final R7 diagnostic.

Correction: after a false acknowledgement, read the journal and treat verified absence of this job id as success. Keep the operation/pending acknowledgement when the record is present or the read fails. A positive acknowledgement remains success without that read. Preserve rejection handling and all safe restart/cleanup behavior.

Update the new false-ack test fixtures to actually return the ready record when their scenario says the journal still contains it. Their beforeEach currently leaves listGeminiJobs returning [], which is inconsistent with that scenario. Set the ready-record mock AFTER herEditThenRegenerate completes, before the attempted save/discard, so startup does not recover an extra job. Keep the existing retention assertions unchanged. This is a fixture correction, not weakened coverage.
