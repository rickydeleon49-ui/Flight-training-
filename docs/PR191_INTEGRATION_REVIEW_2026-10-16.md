# PR191 integration review — 16 October 2026

**Bounded findings only; no formatter implementation acceptance.** Published PR191 head5f06d97986c4e599c8c28819692b1960ee76b4d9, branch `claude/p54-03-formatted-guides`. The active implementer's source and terminal were not edited. Reconcile newer work before applying any correction.

## P54-03-R1 — exact-head CI fails the already-diagnosed readiness race

[Run38989843373](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/38989843373) fails npm test:3283 passed/1 failed/6 skipped. Case `skillScreens.test.ts`, `two quick clicks on Save record one observation`, cannot find Add an observation dialog. This is the same disabled-button/readiness case diagnosed and fixed in the M4 branch; PR191 is based on main without that test correction.

Port only the bounded test-readiness correction (see commit c14afff and its preserved held-listSkills diagnostic), without importing the unaccepted M4 feature. Keep the double-click/one-observation assertion, no retries or broad timeout increases. Preserve this red run. Final exact-head CI must pass; the PR's claim that CI will not contain local flycheck output does not clear this different, observed failure.

## P54-03-R2 — all three current tracker bindings are stale

PR191 prepends ROADMAP/STATUS/PROJECT_HANDOFF entries but leaves the current schema14 completion source-manifest bindings at main's older hashes/lengths. Comparing committed bytes proves all3 mismatches. [Exact hashes](evidence/m4-slice1-r11-r12-review-2026-10-16/pr191-integration-findings.json).

Merge/reconcile current main safely when the active work is ready. Preserve all tracker histories. Refresh only the3 actual current tracker bindings (bytes and SHA-256), generatedAt, and the corresponding3 tracker lines plus source-manifest line in SHA256SUMS. Keep unrelated historical source/receipt bindings unchanged. Verify all21 current manifest entries, track referenced files and run submitted diff hygiene. Re-run the helper in a supported clean/disposable verification lane; do not weaken its intentional target-root guard or delete an active rust-analyzer job's files just to obtain green.

## Integration disposition

Keep PR191 open. These are immediate P54-03 integration fixes and do not change the approved queue order. The new in-house formatter received only a preliminary source read here, not its full parser/rendering/visual acceptance; that review remains pending. No new application implementation, app/profile/provider/native installer/signing/release operation occurred.
