# M2 PR2 read-recovery fix (M2UI-R14) — implementation report, 6 October 2026

**Status: R14 implemented, pending independent review.** This is not source acceptance and not release readiness. R11–R13 were already independently verified and closed by the [read-recovery review](../../M2_PRACTICE_SESSION_PR2_READ_RECOVERY_REVIEW_2026-10-06.md); that controller work is preserved unchanged. Assignment: [read-recovery fix prompt](../../M2_PRACTICE_SESSION_PR2_READ_RECOVERY_FIX_PROMPT_2026-10-06.md).

## Identity and starting state

- Checkout `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-practice-session-ui`, HEAD/base `61031d4c7143fdf181bba2cc18616c5345521c3e`. Fetched once; no pull, reset, rebase or snapshot application.
- All **29** paths in the review's `source-hashes.json` matched before any edit. No competing work was found on the affected files.
- Both prior controller evidence directories and all earlier receipts are byte-unchanged. Nothing was added to them.
- All application changes are uncommitted and unpushed. No app launch, real profile, provider or network call, installed test, signing, packaging or release work.

## What changed

| Path | Change |
| --- | --- |
| `src/pages/StudyLibrary/usePracticeMetadata.ts` (new) | An owned loader for conversion status plus completed-history count. Both reads run under one `Promise.all` with one phase: `loading`, `failed` or `loaded`. Each load gets a request ID, and only the newest request may publish. The effect cleanup invalidates the request on route change or unmount. Retry is locked synchronously while a request is in flight and performs only the two reads. Rejection is consumed in application code. State belonging to another material is never returned. |
| `src/pages/StudyLibrary/MaterialDetail.tsx` | The two unhandled `.then` reads (submitted lines 198–212) and the `completedCount = 0` / `conversionStatus` state are replaced by the hook. On failure the practice card shows fixed, sanitized text with a **Retry practice status** button and an uncounted **View practice history** link. A number appears only after a successful read. The quarantine warning appears only after a successful status read. The saved guide and cards, and the saved practice panel with its own authoritative loader, stay available. |
| `src/pages/StudyLibrary/PracticeMetadataReadRecovery.test.ts` (new) | 12 permanent cases (mapping below). |
| `src/logic/macReadinessPreflight.test.ts` | Case-local `{ timeout: 30_000 }` on the real-subprocess exit-code case, with a comment. Assertions, the 60 s subprocess hard bound and global defaults are unchanged. |

No connection-owner, transaction, recovery, migration, dependency or global test-config change was made.

## R14 closure mapping (actual case names)

The first two cases promote `codex-pr2-material-read-review.test.ts`. They use the same real MaterialDetail, AppDataProvider, disposable node:sqlite database and the same failing SQL. The button selector is adapted to the visible wording "Retry practice status".

| Requirement | Case |
| --- | --- |
| Conversion read rejection is consumed and shows visible, sanitized recovery. The count is unknown rather than 0, an uncounted history link is shown, and the saved practice stays visible. | `[R14] a conversion read rejection shows sanitized, visible read-only recovery and no unhandled error` |
| The same for the history read | `[R14] a history read rejection shows sanitized, visible read-only recovery and no unhandled error` |
| A successful retry shows the real count. Retry sends exactly one read of each kind. There are no `execute`, session, test or import writes and no Gemini calls, and the attempt, response, receipt and version counts are unchanged. | `Retry performs only metadata reads and shows the real count; no write or provider call` |
| Quarantine is preserved after a successful retry, and a failed read is not shown as clean or quarantined | `Retry after a failed status read restores the quarantine warning for malformed legacy practice` |
| The duplicate-retry lock | `a second Retry while one is in flight sends no extra reads, and the held result still publishes` |
| A held old-route success cannot change the new material's count | `a held old-route success cannot set the new material's history count` |
| A held old-route rejection does not show recovery on the new material and is not unhandled | `a held old-route rejection neither shows recovery on the new material nor goes unhandled` |
| A new material clears the previous material's failure | `a new material clears the previous material's failure while its own reads load` |
| Unmount | `reads still in flight at unmount settle without an unhandled rejection` |
| Request ownership within one mounted page (see note) | `an older request's late success cannot overwrite the newer request's result`; `an older request's late failure cannot replace the newer request's result`; `Retry is available again once the newer request settles, even if an older one is still held` |

Every case also asserts that `process` recorded no `unhandledRejection`.

**Note on ownership:** `MaterialDetail` keys its page by material ID, so a route change remounts the page and an old read settles on an unmounted hook. The route-level tests prove the visible outcome. The mutation pass showed they cannot detect a missing ownership guard (see below). The three hook-level cases cover the race that ownership exists for: a rerun for the same material in one mounted page, when the repositories object is replaced.

## Fail-before, pass-after and mutation proofs

- `fail-before/`: `run_fail_before.py` rebuilds the submitted `MaterialDetail.tsx` by reversing the edit. Its SHA-256 `2fd59cfc…eaa608` **equals the frozen review hash**. Against that file:
  - **Frozen review diagnostic:** exit 1, **2 failed, 2 unhandled errors**. This reproduces the review.
  - **New permanent cases (9-case version at that time):** exit 1, **8 failed, 1 passed**. The case that passed is the held old-route success: the submitted `cancelled` flag already blocked late successes, so that case is a regression guard.
  - The corrected file was restored byte-for-byte, and the temporary diagnostic was removed.
- `focused/`: the frozen diagnostic (temporary copy, removed afterwards), the R14 cases, `ImportStudyPacketDialog`, `MaterialDetailOffline` / `Import` / `Gemini`, `PracticeTestPanel`, the three PR2 practice suites, `practiceEraseDurability`, `practiceSessionContract` and `practiceStartupValidation`, run together.
  - `attempt1-before-test-strengthening/`: 155 passed, exit 0, no unhandled errors.
  - After the tests were strengthened (below): **158 passed, exit 0, no unhandled errors**.
  - The CLI file (`macReadinessPreflight.test.ts`) passes **34/34**.
- `mutations/` (`run_mutations.py`): each guard in the hook was removed in turn and the R14 file run against it; every file was restored byte-for-byte.
  - **Killed:** M1 (rejection handler removed), M2 (no ownership check on success), M3 (no ownership check on failure), M5 (no Retry lock) and M6 (a failure shown as a loaded zero).
  - **Survived:** M4 (no request-ID bump in the effect cleanup). It is an **equivalent mutant**: every new load bumps the ID anyway, and React ignores updates to an unmounted hook. It is kept as an explicit statement of intent. `results.json` therefore records `all_killed: false`; that raw result is not altered.
  - The first mutation run found M2–M4 surviving. That finding led to the strengthened route tests (the new material now has its own count, which a late overwrite would remove) and the three hook-level cases.

## Assignment step 3: test lifetimes and the earlier claim

**Correction:** the earlier completion report said the recurring unhandled database-disabled errors came entirely from accepted PR1 and import code. That claim was not established. The two new MaterialDetail metadata reads were definite unhandled consumers inside the PR2 diff, as the frozen diagnostic proves.

After the R14 fix, neither the joint focused run nor the final `npm test` reported any unhandled error or closed-database rejection, so no test-lifetime barrier was added. Limits on that result:

- A non-reproduction in these runs does not prove that every earlier full-run lifetime error had this cause.
- The earlier failed receipts remain valid failures and are preserved unchanged in their own directories.
- This host was not stressed, and no background apps were stopped to manufacture evidence.

## Final sequential source gate (`gate/`, `run_gate.py`, toolchain: Node 22 from Homebrew `node@22`, stable Rust 1.99.0, SDK MacOSX26.5)

| Step | Command | Exit | Result |
| --- | --- | --- | --- |
| 01 | `npm run typecheck` | 0 | clean |
| 02 | `npm test` | 0 | **88 files passed / 3 skipped; 2,568 passed / 4 skipped; zero unhandled errors** (detector in `summary.json`: false) |
| 03 | `npm run build` | 0 | clean |
| 04 | `cargo test --locked --all-targets` | 0 | **391 passed / 6 ignored** |
| 05 | `cargo clippy --locked --all-targets -- -D warnings` | 0 | clean |
| 06 | `cargo fmt --check` | 0 | clean |
| 07 | `npm run test:cargo-lock` | 0 | in sync |
| 08 | whitespace: `git diff --check HEAD`, plus `git diff --no-index --check /dev/null <file>` for every untracked file | **1, then 0** | Attempt 1 (`08-git-diff-check.attempt1-failed.txt`, preserved) flagged 48 untracked files, all verbatim logs in evidence directories plus one older submitted report; no source file was flagged. I added this pack's `.gitattributes` (the same rule the published review packs use) and scoped the check. Rerun: **0 problems** in the tracked diff, all untracked source files and this pack. 32 files in five earlier local evidence directories are listed by name but not edited, because they must stay byte-unchanged. |
| 09 | migration integrity | 0 | Migrations 0001–0011, `migration-checksums.json` and `migrations.ts` are byte-identical to HEAD. No untracked migration files. Every checksum matches. |

The frontend total is +12 over the submitted 2,556, which matches the 12 new R14 cases.

## Manifests

- `source-hashes.json`: SHA-256 of every changed or new path under `src/`, `src-tauri/` and the edited `STATUS.md` / `docs/PROJECT_HANDOFF.md`, **rooted at the repository root**. It lists which reviewed paths changed and which paths are new.
- `SHA256SUMS`: every file in this evidence pack except itself, **rooted at this directory**.

## Remaining limits

- **R14 is implemented, pending review.** PR2 as a whole is not accepted, integrated or release-ready.
- **The sanitized failure wording** is fixed text. It has not been seen on an installed Mac.
- **Survived mutation:** M4 is equivalent; see above.
- **Lifetime errors:** the absence of earlier full-run lifetime errors is a non-reproduction, not a proof.
