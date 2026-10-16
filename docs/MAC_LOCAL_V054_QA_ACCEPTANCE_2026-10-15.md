# Local v0.5.4 QA-01 / QA-02 — independent acceptance, 15 October 2026

**ACCEPT for exact-head CI/integration in PR #167. No new blocking defect found.** Claude's original submission is preserved in local commit `3484302` and its own evidence pack. This review integrates it with accepted main `04d1c6786ccaa6a3c8af7bfa8ad62ab49b23cfc2`, preserving every PR169 application source byte and both tracker histories. The package prepares version0.5.4; it does not produce or certify a new installed candidate.

## Review and validation

All 24 submitted-file hashes and both the QA evidence and 21-line current component inventory verified before edits. The submitted check-only commit c2c33c8153d67f65da5f4ca1a8833f100d68e4c7 was independently compared to all eight changed tracked paths and found byte-identical. Its literal RUNBOOK recipe passed 12/12 stages with version-only dependencyLock and all15 walker cases, successful temporary-worktree cleanup and unchanged source status.

QA-01 narrowly permits aarch64-apple-darwin beside known Cargo output. Each target needs the single-linked Cargo tag and real debug/release profile directories. Unknown targets, unexpected entries, symlinked targets/profiles, missing/invalid/symlinked/hard-linked tags and tracked paths are refused. All original11 walker cases remain; four target cases are additive. No protected-source walker, ignore rule, index/HEAD check, proof pin, immutable contract, migration/fixture or allowlist was relaxed.

QA-02 parses and validates agreeing root versions, requires npm's canonical baseline text, then requires candidate text to equal that baseline with only top version and packages[""].version substituted. Dependency/range/package, integrity/resolution, key-order/formatting and inconsistent root fields still refuse. The RUNBOOK executes the manifest-verified comparator before creating a worktree when locks differ. Identical-lock legacy replay remains supported. Baseline16f9cf3 dependencies are still installed in the disposable replay; a helper-component proof never certifies current app source. Reported mutation checks lacking archived logs are implementation-reported only; independent review relies on actual source and executed named cases/replays.

Version review: package.json, package-lock.json (two root occurrences), Cargo.toml, the root Cargo.lock package and tauri.conf.json change 0.5.3→0.5.4 only. Bundle ID, dependency identities, migrations, backup rules and application code remain unchanged relative to current main. The only non-document differences from main are those five version files and the two reviewed Node scripts.

## Independent combined gate

Scoped Node22.23.3, existing real ARM64 output retained, no native rebuild. [Raw evidence](evidence/mac-local-v054-qa-review-2026-10-15/).

| Check | Actual result |
| --- | --- |
| Submitted helper tests on the genuine ARM64 build tree | 26 passed / 0 skipped; exit0 |
| Submitted literal component replay | 12/12 stages; version-only lock accepted; 15 walker scenarios; cleanup0 |
| Helper tests after main integration | 26 passed / 0 skipped; exit0 |
| npm test -- --maxWorkers=2 | 3,221 passed / 6 skipped; exit0 |
| npm run typecheck | exit0 |
| npm run build (frontend typecheck + bundle) | exit0 |
| npm run test:cargo-lock | exit0 |

The combined component manifest is refreshed after final tracker edits so RUNBOOK replay can read this exact submission. Its final check/merged commit replay and required Linux CI head/run/merge identities belong in the PR closeout; no pending gate is called passed here. The required CI runs its native/Rust checks; no unchanged local native matrix was repeated. Source/document whitespace checks pass; original and new raw tool receipts retain terminal blank lines/trailing spaces and are expressly excluded from a clean all-files whitespace claim.

## Preservation and next action

Original build, failed helper/replay and prior implementation evidence is not rewritten as new execution. Old manifests bind old commits; tracker hashes naturally differ later. The schema14 component's current20-file inventory is regenerated as the documented replay requires; its immutable baseline, tree digest, three restore exclusions and schema contract remain fixed. A separate current review inventory covers the new combined submission. Old app, ZIP and DMG hashes were independently rechecked unchanged in preserved-artifacts.json. No app rebuild/launch/install, hfdtest or real profile/data access, provider call, signing, notarization, publication, global SDK setting or permission change occurred.

After required exact-head CI and merge, the next implementer should follow [fresh local candidate assignment](MAC_LOCAL_V054_FRESH_CANDIDATE_PROMPT_2026-10-15.md). Use the newly accepted main source, retain the pre-PR169 candidate and its identities, record a new frozen source/artifact identity, and keep desktop/installed testing deferred. The old automatic DMG stall is an observation with unconfirmed cause. Public signing/release and M4/M5 proposals stay separate.
