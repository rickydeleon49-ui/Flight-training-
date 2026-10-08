# C2 independent planning review evidence — 7 October 2026

Submitted branch `codex/m2-card-review-c2-scope`, HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`. `submitted-source-hashes.json` freezes eighteen delivery paths in the untouched implementation clone. Submitted four document hashes/thirteen evidence checksums verify. The old STATUS/handoff snapshots are preserved in `submitted/`; coordinator tracking on main records corrections required.

Independent `/opt/homebrew/opt/node@22/bin/node --test`:
- `../m2-card-review-c2-scope-2026-10-07/proof/proof.test.mjs`: **15 pass / 0 fail**, `submitted-proof.exit` = 0.
- `diagnostic.test.mjs`: **2 pass / 7 fail**, `frozen-diagnostic.exit` = 1. Each failure is an expected assertion on the reviewed model, not a runtime/environment error. Ordinary current-version and complete tied-history traversal controls pass.

The executable freezes three discovery/bounds/page cases, two current-version schedule/count cases and two provenance cases. It supports `C2_REVIEW_MODEL=/absolute/path/to/corrected/contractModel.mjs` for an identical scratch diagnostic against isolated corrected proof. Its default resolves the submitted proof relative to this directory. Never modify the frozen assertions to accept a defect.

The original submitted evidence remains byte-identical, including timings/negative-control descriptions now qualified by the review. Performance findings are source/receipt inspection: no alternative cache/backfill measurements are implemented; the reported hash-only loop only parses fifty JSON strings; largest stored event count is 9,874; history page-one p50 9.301ms exceeds the proposed 5ms budget. No independent new performance result or native/installed acceptance is claimed. No unchanged application/native matrix rerun or user profile/provider/app launch.

`published-source-hashes.json` freezes coordinator authored tracking/review/prompt documents and diagnostic. `SHA256SUMS` hashes this review pack except itself. Raw TAP output is retained exactly.
