**P2 — A committed reviewed regeneration can apply again after restart.** [RegenerationReviewDialog.tsx:101](/Users/rickymac/code/Flight-training-offline-03a-fixes/src/pages/StudyLibrary/RegenerationReviewDialog.tsx:101) recognizes retries through `job.reviewed`, which exists only in memory. Recovery at [GeminiJobs.tsx:707](/Users/rickymac/code/Flight-training-offline-03a-fixes/src/state/GeminiJobs.tsx:707) compares the saved merged set against the raw Gemini answer, so it misses an already committed reviewed save.

Reproduced with an in-memory UI diagnostic: commit the reviewed regeneration, lose its response, remount the app with the ready journal entry, then review and save again. History becomes `edit, regenerate, regenerate`; candidate IDs are allocated again.

**Fix:** durably retain the reviewed operation and its connection to the journal job before saving. Recovery must recognize the committed operation and reuse its ID. Add a regression covering app restart after commit but before response or acknowledgement.

The round-4 content fix passes. All 180 focused tests, typecheck and receipt checksums pass. Unchanged native receipts were reused; file-based upgrade and schema-helper reruns were sandbox-blocked. Repository files remain unchanged. Exact-head CI remains unverified.

VERDICT: RED