# Local v0.5.4 QA-01 / QA-02 — reviewer handoff (15 October 2026)

**IMPLEMENTED, PENDING INDEPENDENT REVIEW.** Claude (`claude-opus-5-5`), per [`MAC_LOCAL_V054_QA_FOLLOWUP_PROMPT_2026-10-15.md`](MAC_LOCAL_V054_QA_FOLLOWUP_PROMPT_2026-10-15.md) and the [build report](MAC_LOCAL_V054_BUILD_AND_BUG_TEST_2026-10-15.md).

- **Changed:** scripts and docs only.
- **Unchanged:** no application source, dependency, migration, version, bundle ID, signing or native artifact.
- **Not done:** no rebuild, desktop launch, install, hfdtest, profile access, provider call or publication.
- **State:** the corrections are uncommitted and unpushed. The local check-only commits listed below were never pushed.

## Checkout and starting state

- **Checkout:** `/Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training-`
- **Branch:** `codex/local-v054-build-check`, HEAD `93a88df0523f047fc56a29a9b13a7ab4d4478910`.
  - The build commit is `fee7869`.
  - The accepted functional parent is `f2a7090`.
  - `origin/main` is `04d1c67` (PR #169); this branch does not contain it and was not synced.
- **Before editing:**
  - fetched;
  - the tree was clean at the branch head;
  - no process was using the checkout, and it was last modified hours earlier;
  - the build evidence `SHA256SUMS` verified fully.
- **Why this checkout:** the prompt assigns it, and QA-01 had to be reproduced against its real `src-tauri/target/aarch64-apple-darwin` output.
- **Left untouched:** the real build output, the native artifacts outside Git, every frozen receipt, the primary checkout and other agents' worktrees.

## QA-01 — real Apple Silicon Cargo output was refused

**Reproduced.** `node --test scripts/mac-schema14-profile-snapshot.test.mjs` exited 1, with 22 passed and 1 failed:

```text
src-tauri/target: unexpected top-level entries: aarch64-apple-darwin
```

The real folder holds Cargo's `CACHEDIR.TAG` (1 link, 177 bytes, Cargo signature) and `release/`.

**Tests first.** I added the target-shape test and four walker scenarios before touching the recognizer. They failed on the unchanged code ([`qa01-new-tests-before-fix.txt`](evidence/mac-local-v054-qa-followup-2026-10-15/qa01-new-tests-before-fix.txt)).

**Fix** (`recognizeBuildOutput`, `scripts/mac-schema14-verification-proof.mjs`):

- **Allowed target name:** `CARGO_TARGET_TRIPLES` holds only `aarch64-apple-darwin`, the project's one Mac lane (the readiness preflight's supported host).
- **Allowed contents:** inside that folder only Cargo's tag and real `debug`/`release` profile directories are allowed. The tag must be a regular, single-linked file of 4 KiB or less carrying Cargo's signature (shared `isCargoTag`). Profiles must be real directories (checked with `lstat`) and are not descended, as with host profiles.
- **Report:** the recognizer reports the folder as `targets: [{ triple, entries }]`.
- **Unchanged:** the host-level rules, the `.gitignore` rule check, the tracked-path refusal, the walker, the HEAD and index gates, `PINNED_TREE`, the allowlist and every migration or fixture check.

**Permanent tests** (`scripts/mac-schema14-profile-snapshot.test.mjs`):

- **Accepted:** a disposable correctly tagged `aarch64-apple-darwin/release` tree, including Cargo-style hard links inside the profile, and a tree with both profiles.
- **Refused, each with a named reason:**
  - an unknown target name, or a lookalike one;
  - a stray file at the target root;
  - a stray file or folder beside the target profiles;
  - a target folder that is a file, or a symlink;
  - a symlinked profile;
  - a target tag that is missing, invalid, symlinked or hard-linked;
  - a tracked path inside the target;
  - a missing top-level tag.
- **Walker:** all 11 original scenarios are kept, with 4 added (count 11 → 15, in both the test and the proof stage):
  - Apple Silicon output accepted;
  - an unknown target refused, with every file inside it reported;
  - source beside the target profile refused;
  - a tracked path inside the target refused.
- **Mutation checks:** four breaks (Q1–Q4 in `receipts.json`) were each caught, and the file was restored byte-identical.

## QA-02 — the replay recipe refused a version-only lock

**Reproduced.** The literal RUNBOOK §7 recipe with `HFD_SCHEMA14_SOURCE_COMMIT=fee7869…` exited 1 at the raw `package-lock.json` equality assertion, before any worktree was created ([`qa02-recipe-before.stderr.txt`](evidence/mac-local-v054-qa-followup-2026-10-15/qa02-recipe-before.stderr.txt)). The `git diff 16f9cf3 fee7869` shows only the top-level `version` and `packages[""].version` (0.5.3 → 0.5.4); the locks are identical once those two fields are removed. The original archive `versioned-proof-replay.json` is unchanged.

**Policy chosen: bounded normalization.** Pinning the recipe to the accepted helper commit cannot work here. This branch's lock already says 0.5.4, so even a check-only commit of the QA-01 fix would fail the raw check. The prompt requires replaying those new bytes.

- **`compareDependencyLock`** (exported from the proof runner, Node built-ins only, no side effects on import) accepts the candidate only when:
  - both locks carry agreeing root `version`/`packages[""].version`;
  - the baseline is in npm's canonical form;
  - the candidate is **byte-identical** to the baseline as npm would write it with that one version substituted.
- **Refused:** any package, range, integrity, resolution, name, key-order or formatting change, root versions that disagree, missing root fields, or invalid JSON.
- **RUNBOOK §7:**
  - an identical lock passes exactly as before;
  - otherwise the recipe calls `compareDependencyLock` from the commit's own copy of the proof runner, already hash-verified against the manifest, before creating any worktree;
  - the verdict is recorded in the receipt as `dependencyLock`;
  - the commit's lock is never copied, and the replay still installs the baseline lock on immutable `16f9cf3`.
- **Older commits:** a commit from before QA-02 with a differing lock (such as `fee7869`) has no such function and still refuses, as documented.
- **Scope:** this is a helper-component replay, never a certification of the candidate application.

**Permanent tests:**

- **Accepted:** an identical lock and a version-only bump.
- **Refused, each with a named reason:**
  - a direct dependency added, or its range changed;
  - a transitive version, integrity or resolution changed;
  - a package removed, or the lock name changed;
  - only one root field bumped (either one);
  - root fields removed;
  - reformatting, invalid JSON, or a non-canonical baseline.
- **Build:** the cases are built from the checked-in lock, so CI's shallow clone needs no history.
- **Mutation checks:** three breaks (L1–L3) were each caught.

## Replay of the new bytes (literal documented procedure)

The completion `source-manifest.json` and `SHA256SUMS` were regenerated for the current 20 files, as #166 did; 21 of 21 lines verify. A temporary detached worktree at `93a88df` received exactly the 8 changed files and one local commit, and was then removed. The branch itself is unchanged.

| Commit (local check-only unless noted) | Exit | Result |
|---|---|---|
| `c2c33c8153d67f65da5f4ca1a8833f100d68e4c7`: the 8 changed files | 0 | **PASS**:<br>• proof 12/12 stages;<br>• `dependencyLock` version-only 0.5.3 → 0.5.4;<br>• walker 15 cases including Apple Silicon (the new bytes ran);<br>• cleanup exit 0, worktree removed, source status unchanged.<br>[Receipt](evidence/mac-local-v054-qa-followup-2026-10-15/replay-check-commit.json) |
| `5c61b64ca1ca6e29d1d67b01fa08b92290dbf122`: one package integrity tampered | 1 | Refused before any worktree: "differs from the baseline in more than the application version". Worktrees 11 → 11. |
| `2874ce72ee6f811cc1a43a69fd9ae3b2110e98b9`: only the top-level version changed to 0.5.9 | 1 | Refused before any worktree: "root versions disagree (0.5.9 vs packages[""] 0.5.4)" |
| `fee7869` (real) | 1 | Refused before any worktree: its proof has no `compareDependencyLock` (pre-QA-02, documented) |
| `f2a7090` (real, accepted) | 0 | **PASS**: identical lock, 12/12 stages, cleanup 0, source status unchanged. [Receipt](evidence/mac-local-v054-qa-followup-2026-10-15/replay-f2a7090.json) |

Both negative commits sit on top of `c2c33c8`, and their SHAs are also in `receipts.json`.

## Final verification (Node v22.23.3; scoped Node 22, Cargo and SDK 26.5)

| Command | Exit | Result |
|---|---|---|
| `node --test scripts/mac-schema14-profile-snapshot.test.mjs` | 0 | **26/26, 0 skipped**, including this checkout's real ARM64 output (was 22/23) |
| Five focused Vitest suites (as in the schema-14 handoff) | 0 | 117 passed |
| `npm test -- --maxWorkers=2` | 0 | 3,202 passed / 6 skipped. The branch predates #169. |
| `npm run typecheck`, `npm run test:cargo-lock`, `git diff --check` | 0 | passed |

All raw outputs, exact argv, exit codes, counts, mutation results and check-commit SHAs are in [`evidence/mac-local-v054-qa-followup-2026-10-15/`](evidence/mac-local-v054-qa-followup-2026-10-15/) (`receipts.json`, `submission-manifest.json`, `SHA256SUMS`). No native Rust rerun was needed, because no Rust changed.

## Things the reviewer should know

- **Build evidence pack:** `mac-local-v054-build-2026-10-15/SHA256SUMS` now verifies 33/36 on disk. The 3 others are `ROADMAP.md`, `STATUS.md` and `docs/PROJECT_HANDOFF.md`, which this follow-up updates as instructed. Their recorded hashes equal those files at `93a88df` (checked with `git show`). No file in that pack was edited.
- **Stale manifest at `93a88df`:** the completion manifest there already listed STATUS/ROADMAP hashes from before the build report commit. The literal recipe would therefore have refused `93a88df` itself on the manifest check. The regenerated manifest fixes that for this submission.
- **Merge order with `main`:** this branch is behind `main` (#169). The tracker files will need an ordinary merge, and after that merge the completion manifest must be regenerated again, because it hashes those trackers. This is the same mutable-tracker pattern as #166.
- **Mutation logs:** results were read from the console, not archived; `receipts.json` says so.
- **DMG stall:** not investigated; it remains a separate, unexplained observation.
- **Whitespace in raw receipts:** a `git diff --check` over the new evidence folder flags trailing spaces and final blank lines only inside raw tool-output receipts (`qa01-helper-before.txt`, `qa01-new-tests-before-fix.txt`, `npm-test.txt`, `typecheck.txt`, `vitest-focused.txt`). They are kept byte-for-byte as the tools wrote them, as the build report did for `native-build.log`. The source, docs, JSON and this handoff pass the check.

## Changed and new files

**Modified:**

- `scripts/mac-schema14-verification-proof.mjs`
- `scripts/mac-schema14-profile-snapshot.test.mjs`
- `docs/evidence/mac-schema14-completion-2026-10-15/RUNBOOK.md`
- `docs/evidence/mac-schema14-completion-2026-10-15/source-manifest.json`
- `docs/evidence/mac-schema14-completion-2026-10-15/SHA256SUMS`
- `ROADMAP.md`
- `STATUS.md`
- `docs/PROJECT_HANDOFF.md`

**New:**

- this handoff;
- `docs/evidence/mac-local-v054-qa-followup-2026-10-15/`.

## Reviewer commands

```bash
cd /Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training-
export PATH="/opt/homebrew/opt/node@22/bin:/Users/rickymac/.cargo/bin:$PATH"
export SDKROOT="/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk"
git status --short
shasum -a 256 -c docs/evidence/mac-local-v054-qa-followup-2026-10-15/SHA256SUMS
shasum -a 256 -c docs/evidence/mac-schema14-completion-2026-10-15/SHA256SUMS
node --test scripts/mac-schema14-profile-snapshot.test.mjs
npm run typecheck
git diff --check
```

To replay the new bytes yourself, make your own check-only commit of the overlay and run RUNBOOK §7 with `HFD_SCHEMA14_SOURCE_COMMIT` set to it. After review, integrate through the normal exact-head CI workflow. Physical launch, hfdtest, signing, Gatekeeper and publication remain deferred.
