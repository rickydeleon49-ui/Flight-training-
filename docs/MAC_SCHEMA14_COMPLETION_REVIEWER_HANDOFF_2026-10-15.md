> Historical implementation handoff. Package accepted and merged in PR #165. See [F1–F3 follow-up](MAC_SCHEMA14_FOLLOWUP_F1_F3_2026-10-15.md) for current helper counts and RUNBOOK §7 for exact post-merge reproduction. Earlier measured receipts remain unchanged.

# Schema-14 verification preparation — independent reviewer handoff

15 October 2026. **IMPLEMENTED; PENDING INDEPENDENT REVIEW.** No commit, push, merge or installer build is part of this handoff.

## Where the project stands

Accepted main is `16f9cf3dedbfef0be09711ec42c0f7b8d3ef4b78` (PR #163): the bug sweep, first M5 cost slice, Review due clock correction and supporting maintenance are integrated. M5 requirements remain proposed; M4 is separately owned. PR #164 is an independent controller/CI-history follow-up and was not modified.

This completes the saved REL-01 / MAINT-143-KEYS preparation for review. After independent acceptance/integration, the next release task is the source/version preparation for the owner-selected **local unsigned v0.5.4** candidate, using `MAC_LOCAL_UNSIGNED_V054_CONTINUATION_PROMPT_2026-10-14.md`. Current version files remain 0.5.3. Do not re-ask about Apple membership for this route. Signing, publication and the installed hfdtest run remain deferred.

## Checkout and preservation

- Review checkout: `/Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training-`
- Branch: `codex/schema14-verification-completion`; base/HEAD: `16f9cf3dedbfef0be09711ec42c0f7b8d3ef4b78`.
- Primary `/Users/rickymac/code/Flight-training-` stays clean and untouched.
- Saved implementation: external controller `runs/20261011-231314-695918/worktree` under `/Users/rickymac/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an/outputs/flight-deck-team/`.
- Before copying, all **10/10** saved source-manifest entries and **4/4** evidence checksums verified. Migrations, checksum registry, M3 fixtures and the baseline live schema13 helper have no changes between the saved base `8a260c0…` and current main. The saved worktree was never edited.
- `baseline.json` records observed starting identities and hashes. This observation belongs to this continuation; the original implementer’s missing pre-edit observation remains unavailable.
- Complete saved round-4 package: `/Users/rickymac/.codex/task-recovery/schema14-completion-20261015/saved-round4.tar.gz`, with its hash in `baseline.json`. Pre-existing regenerable `dist/` from this reused checkout was moved to `preexisting-dist` in that recovery folder, so the proof can reject unexplained output without adding a broad ignore rule.

## What is delivered

1. `scripts/mac-schema13-profile-snapshot.mjs`: prototype-free metadata digest map and seven permanent real-SQLite special-key self-checks. The historic schema13 ceiling alarm is preserved.
2. `scripts/mac-schema14-profile-snapshot.mjs`: a separate fixed-lane, read-only operator with a complete schema14 contract, all six M3 tables, 97 schema objects, complete SQLx ledger facts and strict retained-row/file checks. No environment/test route is shipped; adapters exist only in disposable copies.
3. `scripts/mac-schema14-verification-proof.mjs`: real temporary SQLite fixtures, production-writer/validator checks, installed schema12/13 anchor replay, guard reversions and bounded source-walker sensitivity. The saved walker correction and later literal SQLite-prefix/runtime-root link fixes are retained.
4. `scripts/mac-schema14-profile-snapshot.test.mjs` and `src/logic/currentSchemaVerification.test.ts`: permanent helper and production-facing regression coverage.
5. Historical October 11–12 report/receipts retained alongside new measured continuation evidence and [one current future walkthrough](evidence/mac-schema14-completion-2026-10-15/RUNBOOK.md).

### Change made in this continuation

The saved package already contained the requested walker correction and subsequent fixes. Reused it rather than writing a competing implementation. Its proof’s **repository baseline** is now exact accepted main `16f9cf3…`; the immutable **schema contract** remains at accepted `8a260c0…`. Regenerated the protected-tree digest from `git ls-tree -r` at the new baseline: 4,306 protected entries. All non-submitted tracked bytes/modes remain checked. The allowlist adds only named continuation documents/receipts, STATUS and ROADMAP, not directories or arbitrary untracked content.

This distinction is deliberate: changing the repository base does not widen schema compatibility. Existing migrations, fixture identities, schema definitions, ceiling checks, ledger rules and historical installed results are unchanged. Unknown source files and changed/deleted protected migrations remain refused by the walker.

The proof is an **uncommitted-overlay identity check**: its HEAD must be the named baseline and its index’s protected paths must match that tree. Run it in this checkout before committing. After committing/merging, reproduce using a detached worktree at the named baseline with the submitted paths overlaid; do not remove the HEAD check or edit pins just to get green. Focused helper/Vitest tests remain runnable after integration. Outputs from other tasks such as dist/ are intentionally outside the allowlist; use a disposable clean checkout rather than weakening it.

## Measured verification

Runtime: Node 22.23.3; scoped Node22 and Cargo PATH; Cargo check uses SDKROOT `/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`. Exact argv, cwd, times, stdout, stderr and exits are in [execution-receipts.json](evidence/mac-schema14-completion-2026-10-15/execution-receipts.json); detailed stages in [proof-receipt.json](evidence/mac-schema14-completion-2026-10-15/proof-receipt.json).

| Check | Measured result |
| --- | --- |
| Five focused Vitest suites | 117 passed, 0 failed |
| Helper Node tests | 21 passed, 0 failed, 0 skipped |
| Full disposable proof | 12/12 stages PASS |
| Schema14 self-check inside proof | 102/102 PASS |
| Historical schema13 self-check inside proof | 105/106; exit 1 is expected only for its disclosed schema-ceiling alarm |
| Typecheck | exit 0 |
| Cargo lock synchronization | exit 0 |

The proof also runs 11 source-walker sensitivity scenarios, preserves PR #142’s exact six comparison verdicts/diffs, and demonstrates meaningful guard reversions: a removed guard fails the named case while its unrelated control passes. No failing test was skipped, weakened, retried to hide failure, or relabelled. Final hygiene and inventory results are recorded in the continuation receipt/manifest.

No full app build or broad frontend/native matrix was repeated: runtime app code and dependencies are unchanged. CI appropriate to the actual PR must still pass before merge; this local evidence does not replace it.

## Required reviewer actions

Review the actual uncommitted source, not just this report. Do not launch the app, use hfdtest or touch real profiles. Leave separately owned work alone.

1. Confirm checkout, branch, base and all final manifest/checksum entries. Distinguish the October 15 current manifest from the October 11 saved historical inventory: the latter describes the original saved checkout, including its older handoff/proof; it is not a manifest for this continuation.
2. Review metadata own-key behavior with `__proto__`, `constructor`, `toString` and Unicode through real SQLite and JSON; preserve exact three-key restore-only exclusions and strict legacy behavior.
3. Review genuine 13→14 transition checks, missing/failed/wrong-checksum migration14 refusal, complete object definitions, all M3 history/operations and retained files. A no-op upgrade or incomplete snapshot must not obtain PASS.
4. Review the bounded build-output recognition and source sensitivity; verify no broadly ignored source or production bypass. Check literal `sqlite_` exclusion and symlinked runtime-root refusals remain covered.
5. Run the commands below on the frozen submitted files, record exits, and compare final hashes again. Investigate any discrepancy before accepting. Preserve failed receipts.
6. If accepted, commit/push via the normal workflow, require exact-head CI, merge, update trackers to accepted and then continue the selected v0.5.4 source/version task. If defects remain, report concrete scenarios, exact source locations, impact and regression expectations together in one correction prompt.

```bash
cd /Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training-
export PATH="/opt/homebrew/opt/node@22/bin:/Users/rickymac/.cargo/bin:$PATH"
export SDKROOT="/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk"
git status --short
git rev-parse HEAD
node --version
node --test scripts/mac-schema14-profile-snapshot.test.mjs
node scripts/mac-schema14-verification-proof.mjs
node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache src/logic/currentSchemaVerification.test.ts src/data/skillEvidenceUpgrade.test.ts src/data/skillEvidenceValidationParity.test.ts src/data/migrationSafety.test.ts src/data/migrations.test.ts
npm run typecheck
npm run test:cargo-lock
git diff --check
shasum -a 256 -c docs/evidence/mac-schema14-completion-2026-10-15/SHA256SUMS
```

The checksum file uses repository-relative paths. Its entries include the current source manifest, which lists exact sizes/hashes for every submitted source/document/receipt except itself and SHA256SUMS. Confirm new/untracked files as well as the tracked diff before staging; never `git add .` without inspecting the list.

## Limits that must survive review

- These are **source-only synthetic proofs**. Scratch SQLx ledger rows use the actual table definition/descriptions/checksums but are written by the fixture builder, not SQLx. Older installed ledger anchors come from unchanged PR #142 evidence.
- Restore tests place closed SQLite archive-state copies back and migrate them. They do **not** execute the native backup archive/restore pipeline or certify an installed schema14 app.
- No schema14 installer identity exists; nothing was built, installed, launched, signed, notarized or published. No profile, credential or provider was accessed.
- The historical schema13 live helper retains its disclosed inventory limitation and ceiling13; it must not certify schema14. Frozen final-helper bytes and original PR #142 JSON remain unchanged.
- hfdtest/standard-account execution, mid-save behavior, Gatekeeper and packaged Mac verification remain UNVERIFIED/deferred. The future walkthrough is planning only.
- This handoff is implementation completion, **not independent acceptance**.
