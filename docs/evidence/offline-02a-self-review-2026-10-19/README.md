# OFFLINE-02a self-review/finalization evidence

Latest report: `../../OFFLINE_02A_SELF_REVIEW_AND_PAUSE_2026-10-19.md`. Owner decision: `../../OFFLINE_02A_BUDGET_OWNER_DECISION_2026-10-19.md`. **Paused; no independent acceptance or merge.**

The prior completed package at `../offline-02a-completion-2026-10-19/` is preserved byte-for-byte. Its 24 published hashes and ten source hashes were verified before edits. Its frontend and schema-helper results are reused because those sources, dependencies and migrations are unchanged.

- `budget-verdict.json`: original limits remain failed; owner-approved 750 ms/3× limits pass on final source. Original 30k background fallback and all unchanged speed/response/RSS limits are retained.
- `results-self-review.json`: intermediate two-defect-fix source, before explicit initialization status. This is preserved evidence, not the final source's timing claim.
- `results-self-review-final.json`: final source, original frozen corpus/query/filter/expected-set hashes and fixed schedule. 4,050 timed searches; 90 exact reference sets and capped prefixes. First-query timing includes waiting for initialization, never hidden in warm-ups. Managed benchmark files remain disclosed page-JSON fixtures; native service tests cover real PDF binaries.
- `raw-receipts.tar.gz`: both measurement rounds' untouched stdout/stderr/exits, reproduced RED regressions, corrected focused passes, final full native/lint/gate logs and optimized/default-release build logs. `archive-members.json` records every member's SHA-256. Extract only into fresh scratch.
- `gate-exits.json`: final exact commands and exits. 813 native tests pass / 11 ignored; strict Clippy/fmt/lock/hygiene and default-release refusal pass. No GUI, real provider, profile, installer, pressure simulation or minimum-spec test was used.
- `source-hashes.json`: all ten final source inputs and exact measured opt-in harness hash. `SHA256SUMS`: published evidence, excluding itself.

The immutable measurement preregistration remains commit `1f927b5`. The seed, generator, original criteria, material/text counts, queries, filters, expected sets and schedule were not rewritten. The separate owner decision changes only two acceptance limits, not the experiment or its denominator.

Private reproducible inputs/worker remain `/Users/rickymac/.codex/task-recovery/offline-02a-completion-20261019/corpus/`; final generated inputs/owned roots and the retained opt-in binary are in `/Users/rickymac/.codex/task-recovery/offline-02a-self-review-20261019/`. Reuse the original generator/runner only with new scratch roots and new tags; never overwrite old receipts or point a harness at an application profile.

Test scheduling hooks (`AFTER_HASH`, held initialization) exist only under `cfg(test)`. No environment or distributed operator bypass was introduced. Default release refusal and the unchanged dev-only `rusqlite/functions` dependency proof remain required.
