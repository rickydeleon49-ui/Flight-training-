# M2 card-review owner approval — 6 October 2026

**Decision: the owner approves all eight recommended defaults C-D1–C-D8 and authorizes source slice C1.** The owner replied “i approve them” after the corrected scope was independently accepted and all eight defaults were presented for approval.

This decision applies to the [corrected scope](M2_CARD_REVIEW_SCOPE_2026-10-06.md), accepted in [PR #108](https://github.com/rickydeleon49-ui/Flight-training-/pull/108), on main `cf7ed680139a275c417dfcf4b5ff960fc1bb73fc`. The [independent acceptance](M2_CARD_REVIEW_SCOPE_ACCEPTANCE_2026-10-06.md) closes CRS-R1/R2. Its receipts and evidence remain historical, unchanged snapshots.

| Default | Approved decision |
| --- | --- |
| C-D1 | Versioned deterministic `simple-v1`; FSRS deferred. |
| C-D2 | Again 10 minutes; first Hard/Good 1 day, Easy 3 days; ladder 1/3/7/16/35/75/150/180 days; Hard stays, Good advances one rung, Easy two; maximum 180 days, no user configuration. |
| C-D3 | Exact ordered content-addressed versions per material; changed content starts fresh, identical A→B→A retains A's history; no fuzzy carryover. |
| C-D4 | Material deletion erases card content/state/events, retaining non-content receipt tombstones. Explicit per-material reset erases schedules/ratings, preserves current cards, guide and practice, prunes inactive snapshots and advances the review generation; older backups remain unchanged. |
| C-D5 | Stored UTC instants; Again due at the exact instant, day cards before the exclusive next local midnight. Eligible Again, other due, then new; 10-new/20-unique session caps after filtering; refuse clock rollback. |
| C-D6 | Suspend/flag excludes current cards from review until resumed/unflagged and retains history; works before the first rating without a fake review event. |
| C-D7 | Material-page review and compact recent history in C1; cross-material Review due/History deferred to C2/M2-4. |
| C-D8 | No new production dependency; FSRS remains research evidence only. |

## Active assignment and authority

Any owner-selected model may execute the [complete authorized C1 implementation prompt](M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md) in `/Users/rickymac/code/Flight-training-pr70-integration`, from clean current main on `codex/m2-card-review-c1`. This authorizes the scoped source changes, migration and disposable verification described there. Allocate migration 0012 only after confirming main still ends at 0011; otherwise use the next free number and disclose it. The real-user check-in waiver remains in effect. No repeated product-scope approval or check-in is required for this bounded assignment.

The implementer must leave source and evidence uncommitted and unpushed for Codex's independent review and Git coordination. This approval does not constitute source acceptance or authorization for provider calls, real-profile/account testing, installed testing, signing, packaging, version changes or release. Those gates remain separate.
