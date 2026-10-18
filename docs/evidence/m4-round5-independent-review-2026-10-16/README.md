# M4 round5 independent review evidence

Read `../../M4_ROUND5_INDEPENDENT_REVIEW_2026-10-16.md` and its single correction assignment.

- `submitted-all-hashes.json`:594 original M4 input hashes; `post-review-preservation.json` verifies all remained unchanged.
- `submitted-pack/`:20 exact candidate/proof/runner/engine-manifest files, sealed in `specimen-source-hashes.json`. This is a diagnostic specimen, not integration of the unaccepted M4 delivery package.
- `accepted-main-migrations/`:14 references from pinnede8720003, individually compared with Git in `migration-reference-verification.json`; never registered/applied to the app.
- `replay-results.json`, `node22-baseline/`, `node26-baseline/`: full runner commands/exits, raw receipts, success manifests and captured install records. Node26 reuses a genuine npm10 install in the SAME disposable clone. No npm12 success is claimed.
- `node*-original-*`: old specimen baselines, prior four fail and frozen five pass. `node*-prior-four.log` and `node*-frozen-five.log`: corrected-pack replays, all pass.
- `additional-diagnostics.test.mjs`: four ownership assertions (R37/R38). `signal-diagnostic.test.mjs`: real-runner R39 probe. These default to the frozen specimen and sidecar migration references, or accept M4_REVIEW_TARGET_PACK. `node*-portable-diagnostics.log` records5/5 failing on both lanes. Failure is the review finding, not a claimed passing gate.
- `initial-probe/`, `pre-publication-*`, `node*-additional.log`, signal probe records: preserved probe-development receipts; final runnable diagnostics and their exact receipts are the portable pair above.
- `actual-full-runner-*`: actual failed-record and invented-mutant probes; both exit1 as required, demonstrating R35/R36 corrections.
- `mapped-behavior-preservation.json`: all72 prior mapped names retained,21 additions; actual20 mutants recorded.
- `pr178-*`: independent RELREC-01 inventory/helper/hygiene checks and exact-head CI/merge receipts. All six actual JPGs were visually inspected in PR178; they are not duplicated here.

All tests ran in reviewer-owned disposable clones or in-memory databases. No application/Rust build, desktop launch, profile/key access, provider call, signing or publication. .gitattributes only preserves exact raw/frozen receipt bytes where whitespace would otherwise be normalized. `inventory.json` lists every evidence file except itself and SHA256SUMS; SHA256SUMS additionally binds that inventory, the review/prompt/current trackers and the refreshed existing helper manifests.
