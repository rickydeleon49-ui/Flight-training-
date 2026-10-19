# Review round 1 corrections — current evidence

R1–R4 are fixed in the same uncommitted worktree. See the implementation report's **Review round 1 corrections** section for the finding-to-fix/test map and timing limits. The Claude review is retained in `claude-review-round1.md`.

- `round1-before-native-serial.log`: clean R1/R3 pre-fix failures, 10 pass / 2 fail. The parallel `round1-before-native.log` also hit timestamp-only test-directory collisions; those fixture paths now include an atomic counter.
- `round1-before-frontend.log`: R2/R4 pre-fix failures from ordinary service spies and markup assertions.
- `round1-native-focused-expanded.log`: 13 pass; guide cards (including malformed fields) discarded, guide-only schema captured, 3 generation calls for 20 cards, monotonic remaining allowance persisted and exhausted resume sends nothing.
- `round1-frontend-focused.log`: 58 pass. `round1-frontend-additional-focused.log`: 24 pass. `round1-all-affected-frontend.log`: all 82 affected page tests pass together.
- `round1-frontend-development.log`: retained transitional failures from older auto-save expectations.
- `round1-first-gate-results.json`, `round1-first-gate-*.log`: retained first gate attempt; eight more old auto-save test expectations were identified and corrected. Native 683 pass / 6 ignored; helper 25/26.
- `round1-final-gate-results.json`, `round1-final-*.log`: final complete gate after those test-only corrections. Frontend **3,699 passed / 6 skipped**; Cargo **683 passed / 6 ignored**. Typecheck, build, strict Clippy, fmt, lock and diff checks pass; schema helper **25/26**, with the known sandbox process-list failure. `current-gate-summary.json` maps these current receipts.
- `round1-source-changes.patch`, `round1-worktree-status.txt`, `round1-SOURCE_SHA256SUMS`: refreshed source/handoff evidence; includes the untracked batch module. Prior source snapshots remain unchanged.
- `SHA256SUMS`: refreshed digests for every evidence file except itself.

The schema helper's sandbox process-enumeration failure is recorded as returned. Claude independently reported **26/26 outside the sandbox**; this is not a locally reproduced outside-sandbox result. No helper/manifest modifications or process-permission bypass. No commit, push, merge, provider/key/profile use or app launch. Only synthetic loopback HTTP tests.

---

## Historical implementation evidence (superseded)

# GEN-REL-05 continuation: implementation complete, one environment gate blocked

This section supersedes the historical BLOCKED/incomplete notes below. Loopback now works. R12's held-DELETE tests pass; GEN-REL-05 is implemented and its ten focused native batch tests pass. The implementation report and reviewer prompt are in `docs/`.

Current receipts:

- `r12-network-enabled.log`: five R12 regressions pass, including both held-DELETE paths.
- `batches-final-focused.log`: ten native batch tests pass; measured bytes and request counts are printed as MEASURE lines.
- `final-gate-results.json` and `final-*.log`: one final gate invocation. Native tests 680 passed / 6 ignored, build, typecheck, strict Clippy, fmt, lock and diff checks passed. The frontend had one stale progress wording assertion; corrected frontend/typecheck receipts are separate.
- `corrected-frontend-tests.log`, `corrected-typecheck.log`: checks after updating that test-only assertion to the nine-submission study-job contract.
- `final-schema14.log`: 25/26. Sandbox-denied process enumeration prints pgrep/sysmon diagnostics before REFUSED. This is not generated build output; flycheck0 was absent. Neither frozen helper nor manifest was changed. This remains the integration gate blocker.
- `current-gate-summary.json`: authoritative current receipt mapping, including the corrected frontend result and remaining helper failure.
- `prior-blocked-implementation-report.md`, `prior-blocked-reviewer-prompt.md`: original incomplete reports, preserved verbatim.
- `compile-batches-first.log`, `batches-first/second/third.log`, `frontend-focused-first/second.log`, `typecheck-development-2.log`, `clippy-development-first.log`: retained development failures; the report explains their classification. Later corrected focused receipts are separate.
- `final-source-changes.patch`, `final-worktree-status.txt`, `final-SOURCE_SHA256SUMS`, `continuation-environment.json`: final uncommitted source/handoff identity. Earlier unprefixed source snapshots remain historical.
- `SHA256SUMS`: all evidence files except itself, regenerated only after receipts settled.

No commit, push, merge, app launch, real provider/key/profile, dependency, migration or version change. Public provider documentation was read; all test HTTP went to synthetic loopback servers. Protected coordinator files and the schema-14 manifest remain unchanged. Live-provider and installed-app behavior are UNVERIFIED.

---

## Historical first run — superseded, retained unchanged below

# Blocked GEN-REL-05 / partial R12 receipts

All inputs are synthetic. No real provider, key, profile data, private document or application launch was used. No source commit, push or merge was made. Cargo was offline; Node 22 was on PATH; the requested SDKROOT was scoped to Cargo.

- `r12-before.log`: first focused run, before the source correction. Both new tests failed at the forbidden loopback listener bind, before exercising R12. Not a product-red reproduction.
- `gate-results.json` and named logs: the final requested gate, invoked once after source changes. Seven checks passed; Cargo tests and the schema helper failed. The transport-free R12 ownership test passed. See the implementation report for counts and limits.
- `failure-classification.json`: all 95 native test failure blocks contain `Operation not permitted`; panic locations are retained. The source fix's held-DELETE tests remain unverified.
- `schema14.log`: 25/26 passed. Sandbox-denied process enumeration printed `pgrep`/`sysmon` diagnostics ahead of the expected refusal prefix, failing the anchored assertion. The refusal itself occurred. No helper correction or rerun.
- `environment.json`: tool versions and base source identity.
- `run-gate.py`: local recipe used for the one final gate. It records each command and exit code, keeps Cargo offline, scopes SDKROOT to Cargo, and removes flycheck0 before the schema helper if present.
- `source-changes.patch`, `worktree-status.txt`, `SOURCE_SHA256SUMS`: uncommitted source and handoff identity. Coordinator-owned protected files are absent from the changes.
- `SHA256SUMS`: hashes of all other files in this evidence folder, including the source checksum manifest; excludes itself.

There are no GEN-REL-05 upload-byte or batch-request measurements: batching is not implemented and HTTP fixtures cannot bind. Do not treat these receipts as complete GEN-REL-05 acceptance evidence. Keep failures separate from any future permitted-environment run.
