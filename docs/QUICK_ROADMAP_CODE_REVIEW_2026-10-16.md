# Quick code review and roadmap reconciliation — 16 October 2026

Scope: recent navigation/export corrections, the current navigation+formatted-guide merge, integration status and current evidence. This is a bounded follow-up, not a fresh whole-repository or installed-app audit.

## Confirmed finding: NAV-UI-01 [P3], retired panel notices

**Trigger:** start Check pages under repositoryA; keep the same material/panel mounted while repositories switch toB; wait until B's70-page identity is visible; complete A's held check with changed=true or a failure. `DocumentPagesPanel.tsx:151–159` unconditionally sets `checkNote`/`actionError` after awaiting `nav.checkPages()`. The hook correctly refuses A's follow-up read, but the panel announces A's old changed-file or missing-file result over B.

Both success/error variants reproduce with the real navigation hook/controller and stand-in repositories. Current state stays B; no stale write or reader-open behavior was reproduced. Ordinary material-route navigation remounts MaterialDetail at key={materialId}; the demonstrated case is repository replacement under the same mounted material. Treat this as a bounded follow-up after navigation integration, not a new blocker for the corrected R11/R12 source.

### Precise next implementation scope

Bind the panel's check notification to the material/repository/controller/lifetime that initiated it. Refuse obsolete completion publication before setting a success note or error. Clear context-owned notices when that context retires; merely clearing them in an effect is insufficient because the held completion can repopulate them afterwards. Retain live-context changed-file/error messages and existing navigation write/hash/lease guards. Do not alter persistence, schemas, dependencies or opener behavior.

Promote the two frozen cases and positive controls to permanent tests: A success and A rejection after repository replacement publish no notice over B; B's data/loading stays intact; a current check still announces a real change/error; unmount/material remount stays safe. Review analogous action notifications for the same pattern, but expand the fix only for demonstrated behavior. Keep it separate from accepted R11/R12. No app launch or profile work needed.

## Current integration state

- **P54-03/#191:** merged on main. The combined navigation+formatted-guide build/typecheck passes this review.
- **M4 corrections/#194:** merged into PR189 at4f2aef8. `docs/M4_LIFECYCLE_ACCEPTANCE_2026-10-16.md` on navigation headc9ad743 records Claude's independent source review and local evidence. The four correction input hashes remain unchanged. PR189 includes main6b4d408; its current combined-source CI39003239028 was still running at this review snapshot. Refresh/reconcile current main before final normal exact-head integration.
- **Export corrections/#195:** merged into PR193 at27c3971. Its application source is unchanged from bb57c4b. CI39002710742 is green on27c3971, but targets the old formatted-guide branch66b9f24, not current main. Retarget/reconcile PR193 with main after navigation integration and require final current-base CI. No independent export acceptance record was found in that submitted tree or PR review/comments; record who reviewed it and the actual scope/results before final acceptance. This is an evidence gap, not proof that no review occurred elsewhere.
- **P54-02 search:** remains a proof task. Native/browser FTS5 divergence, extraction allocation/cancellation limits and query semantics still need the phase2 proof. No engine/dependency has been selected. Continue the existing `P54_02_EXTRACTION_WORKER_PROOF_PROMPT_2026-10-16.md` after integration work; no reprioritization.

## Checks and limits

126 existing focused navigation/formatter tests pass;2 new diagnostic assertions fail as expected. Production web build/final typecheck passes on Node22. Correction source/evidence/helper manifests all verify against Git. No broad native matrix repeated; existing CI/local reports remain separate evidence. Earlier failing receipts and active worktrees are preserved. [Frozen diagnostic and receipts](evidence/quick-roadmap-review-2026-10-16/README.md).

No additional release blocker was reproduced in this quick check. Final current-base CI, recorded independent source acceptance and any required installed release gates remain separate prerequisites; source tests do not satisfy installed/WebKit/VoiceOver verification.
