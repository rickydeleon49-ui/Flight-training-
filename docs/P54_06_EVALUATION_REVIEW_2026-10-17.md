# Independent review of Gemini's P54-06 evaluation

**Original e8da4d5 needed corrections before guiding implementation. Documentation corrected on codex/fsrs-evaluation-review-20261017; no production adoption or merge.** Original report is preserved in Git and its author worktree is untouched.

## Findings and resolutions

- **FSRS-R1 — erased history / replay premise.** Original sections1,2.4 and5.1 described an immutable complete log across all generations and recovery of earlier history from identical content. Actual native reset deletes material review events/state, prunes versions and tombstones operations. Corrected report limits replay to surviving history and requires an explicit partial/missing-history transition without resurrection. Sources: `src-tauri/src/card_reviews.rs` reset transaction; migration0012 cascades; cardIdentity retained-history contract.
- **FSRS-R2 — unsupported parity and safety guarantees.** Original sections6/8 claimed rounding and an in-house port guarantee bit-identical results and total supply-chain safety. Rounding cannot prove this: opposite sides of a half-integer round to different days. Corrected report requires independent vectors, numeric/clock bounds, a rounding policy and measured parity. It makes no safety/maintenance guarantee for a new port.
- **FSRS-R3 — mixed algorithm/package versions and unsafe migration direction.** Original proposal combined FSRS-v6 wording with19 weights and fsrs-v5 identifiers, and treated schema16/helper updates as decided. Official algorithm reference distinguishes21-parameter FSRS-6 from19-parameter FSRS-5. Inspected TS package is5.4.2 (not6.x); Rust package6.6.2. Corrected report pins inspected repository identities, leaves algorithm/storage selection pending and preserves the historical schema14 helper's frozen contract rather than retargeting it to a new schema.
- **FSRS-R4 — unmeasured product/calibration claims.** No owner history was measured, so average review volumes, a universal optimization cutoff, fixed95% workload multiplier and asserted checkride benefits cannot guide adoption. Withdrawn. Preserve `simple-v1` until a bounded synthetic feasibility experiment supplies evidence. Retention UI and library-rule exceptions remain undecided rather than forcing five owner questions before feasibility work.

## Scope and validation

Checked actual scheduler, identity, native reset/transactions, local-day handling and migration0012. Queried primary GitHub package metadata and the official algorithm reference. [Repository identities](evidence/p54-06-evaluation-review-2026-10-17/repository-identities.json) preserve versions, stars/licenses and inspected source blobs; source hash inventory identifies the baseline read. No engine, benchmark, schema or app changes were made. No full application suite rerun for documentation; refreshed tracker bindings and helper/hygiene checks are the applicable local gate.

The corrected evaluation is a decision aid, not mathematical implementation proof. It proposes a non-production feasibility experiment before architecture/adoption decisions. Current production source stays byte-identical to2fc27b9. Preserve owner profiles and the current P54/Study Hub order. No merges.

## Next model

First independently review Codex's calendar correction in draft PR208 using P54_05_CALENDAR_BOUNDARY_REVIEWER_PROMPT_2026-10-17.md; do not merge. For P54-06, read the corrected evaluation and prepare only a bounded feasibility assignment with a pinned algorithm/reference-vector contract, synthetic histories, reset/missing-history cases, numerical boundaries and due-date preservation. Do not import a below-threshold implementation, allocate a production migration, add a retention slider or alter authoritative scheduling as part of that preparation.
