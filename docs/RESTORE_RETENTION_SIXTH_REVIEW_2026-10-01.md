# Restore retention — sixth independent review

Date: 1 October 2026. Reviewer: Codex. Windows source and isolated native/UI tests only; no installed Windows or Mac smoke test.

## Decision

**Hold commit, push, merge and A1 acceptance.** The three previously reproduced restart defects G1–G3 are corrected: all four permanent round-five tests pass independently, and the full existing backup suite passes **137 tests**. The latest review nevertheless confirms one cleanup error-handling defect, one calendar-dependent test failure, and incomplete critical transition evidence. These are a focused follow-up, not a request to redesign restore or reopen the passing defects.

No original DB/WAL/document loss was observed in this review. The cleanup reproduction preserves its payload but incorrectly deletes its ownership plan before payload cleanup succeeds.

## Reviewed state and preservation

- Repository: `H:\Ai Repo clones\Flight-training-`; GitHub `rickydeleon49-ui/Flight-training-`.
- Branch: `fix/restore-retention-restart-safety`.
- HEAD/base: `053af1fcd1429888300060f780a10d68adc81c5b`.
- `src-tauri/src/backup.rs` reviewed/restored SHA-256: `5CC87592C02397DF734D7BFA760A17C86BC8E70FA2A47FADCCDF4796475B2E97`.
- `src/pages/FlightJournal/debriefLinks.test.ts` reviewed/restored SHA-256: `1EB9B9F0605EBA554D4F265649CA080BA6D9F7FD53B26B9488CB1771C9905B2B`.
- Nine pre-existing tracked modifications and five historical review notes are preserved. Review-only documentation is updated; application/test source changes made temporarily for reproductions are restored byte-for-byte.
- All five historical notes match their actual prior hashes. The pasted handoff associates several correct hash values with the wrong filenames; its hash table is not authoritative. The actual path/hash map is saved with the evidence.
- All test data was synthetic and isolated. No owner's application profile, API key, installer or release asset was used or modified.

## Confirmed findings

### H1 — P2: failed payload enumeration still deletes the pending ownership plan

Location: `src-tauri/src/backup.rs:2584–2607`, `remove_pending_directory_safely`.

The helper treats `read_dir` failure as an empty enumeration through `if let Ok(entries)`. It also discards individual entry errors with `entries.flatten()`. Both paths continue to unlink `restore.json` before knowing that all payload deletion succeeded. This contradicts the newly documented payload-before-plan guarantee and discards the original inspection error.

**Native reproduction:** create a disposable owned pending directory with a valid plan and SQLite payload. Deny only directory listing to the current Windows identity using a reversible ACL on that directory; leave access to the known plan/payload paths intact. Verify `read_dir` produces an actual `PermissionDenied` and ownership verification still returns `Ok(true)`. Call the real cleanup helper.

```text
directory_read_error=Some(PermissionDenied)
ownership=Ok(true)
cleanup=Err(DirectoryNotEmpty)
plan_preserved=false
payload_preserved=true
```

The helper deletes the plan, then fails to remove the nonempty directory. The test restores the ACL and removes its synthetic directory before the final preservation assertion, which fails. This is an observed permission-error path, not an injected directory-return value.

**Impact and limit:** the ownership plan is lost while payload remains; the original permission error is hidden behind a later directory-not-empty error. The new recorded-manifest fallback may allow retry when all remaining bytes match the journal; this reproduction does not establish permanent startup blockage or data loss. It proves the claimed preservation/error contract is false, and entry-enumeration errors have the same unchecked code path.

**Correction:** propagate directory and entry errors before touching the plan. Delete the plan only after every payload cleanup has succeeded, with fallible no-follow inspection. Distinguish genuine already-absent state from permission/I/O errors; preserve safe bounded retry, manifest fallback and unknown-owner refusal.

Failing independent assertion: `round6_cleanup_enumeration_error_must_preserve_ownership_plan`.

### H2 — P2: replacing one fixed future date with another postpones a known CI failure

Location: `src/pages/FlightJournal/debriefLinks.test.ts:91` (lesson fixture), `194` (lesson-link assertion); application date filtering is working as intended.

The implementer changed the scheduled lesson from `2026-09-30` to `2026-10-05` after calendar rollover broke the workflow test. The test still uses the real current day. Once that lesson becomes past, the upcoming-lesson selector excludes it and the saved instructor question receives no lesson link.

**Reproduction:** temporarily use Vitest's Date-only fake clock in this suite, keeping asynchronous timers real. Run only the unchanged deliberate-workflow test under two local midday dates:

| Simulated date | Result |
| --- | --- |
| `2026-10-01` | 1 passed; 11 excluded by focused filter |
| `2026-10-06` | 1 failed; 11 excluded by focused filter; expected saved `question.eventId` to equal the lesson ID, received `null` |

The test source is restored exactly after each run. This reproduces the calendar dependency without changing the machine clock or application code. It is a test-fixture defect, not a finding that the product should allow past lessons in its upcoming selector.

**Correction:** use a scoped deterministic Date clock with reliable restoration, or derive and assert a future lesson date through a deterministic test clock. Keep UI waits real and preserve the actual saved-link assertions. Do not push the fixture further into the future, widen the application filter, skip the test or weaken the expected linkage.

### H3 — P2: the claimed return/canonical-preservation matrix remains partly unimplemented

This is an acceptance/evidence gap rather than an additional proven data-loss defect.

- `task4_wal_selected_install_failure_uninstalls_wal_and_recovers_original` at `backup.rs:9269` creates its selected WAL filename using `write_database`, which produces an ordinary SQLite DB, not a WAL. The original WAL is genuine. The only injection is `InstallDbRename(1)` before selected WAL movement; the test does not inject original WAL return. Do not label it genuine selected-WAL installation/uninstallation plus return-failure coverage. The older `round2_legacy_restore_wal_is_not_mixed_with_returned_original` provides useful genuine selected-WAL evidence and should be reused accurately where applicable.
- `task4_document_selected_install_failure_recovers_original_documents` at `9323` injects only `InstallDocsRename`. There is no test setting `ReturnDocsRename`, and no test setting `ReturnDbRename(1)`. Existing return-fault coverage sets only DB index 0 and stops while blocked. A later successful rollback is not a return-failure test.
- `task5_occurrence_journal_update_failure_preserves_prior_canonical_journal` at `8776` is unchanged. It still checks `hits() >= 1`, examines the later `RolledBack` journal, and performs only one post-failure launch. It does not compare the prior canonical bytes at the failed write. The handoff's claims of byte-identical canonical preservation and two post-failure decisions are not established by that test. The passing new round-five tests independently prove fired-count/restart behavior, which is useful but distinct.
- Unix directory `File::open` and `sync_all` errors are still ignored at `1701–1703`. This must be documented as best-effort, with a defined testable contract if changed. An ordinary private error seam does not require privileged VFS injection. No actual Unix directory durability was tested here.
- The existing root/backups/plan/inventory tests were not updated to the full repeated-startup evidence claimed in the handoff. Report only their actual assertions or extend them narrowly.
- The serialized lock-test journal in `task4_valid_canonical_journal_under_real_windows_lock_blocks_and_recovers` records a digest of the row text and size 13 rather than the actual SQLite artifact. It proves denied-read routing, but is a poor valid-dataset recovery oracle. Use exact fixture identities and report the actual terminal decision instead of claiming an unasserted `ProceedNormally` second launch.
- Current documentation is internally inconsistent: STATUS claims local G1–G4 completion, but the audit's top summary, backup-format status and MAC-08 still present G1–G3 as currently failing. Historical notes must stay unchanged; current summaries need one accurate latest decision.

**Correction:** add the two missing return-fault tests, use/accurately classify genuine WAL fixtures, prove prior canonical bytes at the relevant failure boundary, and correct phase/count/outcome/durability documentation. Reuse meaningful existing coverage rather than duplicating a broad matrix.

## Passing evidence

The permanent round-five tests genuinely retain their conservation/restart assertions and add fired-injection tracking. Independent execution confirms all four tests pass. The production changes fix abandoned current-attempt journal files, genuine legacy ownership mismatch and original SHM cache requirements. Modern missing/foreign ownership still refuses unknown cleanup in the existing suite. Known-manifest recovery after plan removal has dedicated positive/negative tests.

The full existing native backup suite passes all 137 tests, including earlier no-follow, unknown destination, WAL mixing, manifests, rollback, export-integrity and archive-compatibility regressions. Passing these tests does not cover the newly denied-directory case or the missing injected return boundaries.

## Independent commands and logs

Evidence directory: `C:\Users\ricky\Documents\Codex\2026-09-06\continue-work-on-my-private-github\outputs`.

| Command/check | Result | Log |
| --- | --- | --- |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml backup::tests::round5_ -- --nocapture` | Exit 0; 4 passed; 0.41 s | `restore-review-round6-2026-10-01-round5-tests.log` |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml backup::tests::` | Exit 0; 137 passed; 30.72 s | `restore-review-round6-2026-10-01-existing-tests.log` |
| Temporary `cargo test --locked --manifest-path src-tauri/Cargo.toml backup::tests::round6_ -- --nocapture` | Cargo exit 101, wrapper exit 1; 0 passed, 1 failed; 0.41 s; compilation 1m22s | `restore-review-round6-2026-10-01-corrected-reproductions.log` |
| `npx vitest run src/pages/FlightJournal/debriefLinks.test.ts -t 'deliberate workflow'`, temporary Date-only clock `2026-10-06` | Exit 1; 1 failed; 11 filtered out; 29.85 s total | `calendar-review-2026-10-01-as-2026-10-06.log` |
| Same focused test with clock `2026-10-01` | Exit 0; 1 passed; 11 filtered out; 19.79 s total | `calendar-review-2026-10-01-as-2026-10-01.log` |
| `git diff --check` | Exit 0 before review-note edits; repeated after updates | Final hygiene log |

The first ACL attempt failed in the review harness because Windows PowerShell could not load the module providing `Get-Acl`. It did not reach the product assertion and is not app-defect evidence. The corrected harness uses .NET directory ACL methods, reaches the real OS denial, restores permissions and proves H1. The first attempt's identified synthetic directory was removed after verifying it was an unlinked child of the intended temporary directory. The helper scripts preserve exact source snapshots and refuse concurrent overwrite before restoring source in `finally`.

The implementer reports a green complete matrix: 594 frontend passed/4 skipped and 255 Rust passed/6 ignored, plus build/fmt/clippy/lock/version checks. These are reported results, not independently rerun here. No complete matrix or CI was repeated after confirmed blockers. No review verification matrices overlapped.

## Next action and platform limits

Fix H1 and H2, finish the small H3 evidence list, run focused checks per task and one final sequential matrix, then return the uncommitted branch for acceptance. Preserve all passing G1–G3 cases and all five historical reviews. Keep A1 pending independent acceptance, A2–A6 open and release holds unchanged.

Physical Apple Silicon/macOS 12, installed Windows, live Gemini and exact future-candidate smoke tests remain **UNVERIFIED**. The frozen v0.5.3 DMG cannot certify the changed source.
