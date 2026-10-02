# Restore retention — seventh independent review

Date: 1 October 2026. Reviewer: Codex. Windows source review and isolated native/UI tests; no installed-app or Mac smoke test.

## Decision

**The functional H1/H2 corrections and the missing H3 return/canonical-byte coverage pass independently. One small acceptance-test assertion and the current evidence summaries still need correction before committing this branch.** This review does not reproduce a new application data-loss or recovery defect. Do not redesign the passing restore implementation or reopen G1–G3.

The independently executed backup suite passes **143 tests**, including the real Windows listing-denial case, entry-read obstruction/retry, original WAL/document return failures, exact lock-fixture identities and prior canonical-byte comparisons. All **12 debrief-link tests** pass with the new scoped Date-only clock. Strict Rust lint passes on current source.

A1 remains pending final independent acceptance. A2–A6 and release holds remain open. No commit, push, CI run, installer build or release change occurred in this review.

## Reviewed and preserved state

- Repository: `H:\Ai Repo clones\Flight-training-`; GitHub `rickydeleon49-ui/Flight-training-`.
- Branch: `fix/restore-retention-restart-safety`.
- HEAD/base: `053af1fcd1429888300060f780a10d68adc81c5b`.
- `src-tauri/src/backup.rs`: SHA-256 `33DF2245850D3DF47A71797D0DAD72973C0E1E7A161AB63E8D7ECFE9DFCBD61B`.
- `src/pages/FlightJournal/debriefLinks.test.ts`: SHA-256 `58A01DCA1A942312BC7A45B47EADE0B30422ECCEF8CFDF71FA46C5C6F6856975`.
- Nine existing tracked modifications are preserved. Application/test source was restored byte-for-byte after a guarded temporary oracle check.
- All six prior independent review notes remain unchanged, including the sixth note at `DF29B51674B8C2D3E164BF4C5BEEE93F02853BECACBFCA40E9DB0596561A7F38`. The other five retain the path/hash mapping recorded in round six.
- Fixtures were synthetic and isolated; no real profile, uploaded user document, API key or release asset was accessed.

## R1 — P2: the new journal test checks the wrong temporary filename prefix

Location: `src-tauri/src/backup.rs:9772–9777`, `task4_prior_canonical_journal_preserved_on_write_sync_rename_failures`; compare actual journal creation at `1653`.

The direct journal test meaningfully asserts prior canonical bytes/hash and successful replacement after four injected failures. Its additional claim that no temporary sibling remains is not actually enforced:

```rust
!name.starts_with(".tmp-")
```

The application creates `restore-journal.json.tmp-<pid>-<nonce>`, which does not begin with `.tmp-`. The test therefore accepts leftover files with the real application prefix.

**Independent reproduction:** temporarily seed `restore-journal.json.tmp-review-oracle` immediately before the existing enumeration assertion, after each failed write. Assert the seed exists, then run only the unchanged assertion/test logic. All four subcases log `wrong_prefix_match=false`; the test passes with the seeded leftover present. Its fixture is subsequently removed by its normal explicit scratch cleanup. A guarded runner restores the source bytes exactly in `finally` and verifies the original SHA-256.

```text
review_seeded_temporary="restore-journal.json.tmp-review-oracle", wrong_prefix_match=false
... repeated for all four injected boundaries ...
test result: ok. 1 passed; 0 failed
```

This is a **test-oracle defect**, not evidence that `TmpJournalGuard` currently leaves a file behind. The functional round-five restart regressions and current direct byte comparisons pass. Fix the real-prefix assertion, then show the corrected check rejects a seeded real-prefix leftover before claiming this part of C3 complete.

**Small correction:** detect siblings using `format!("{RESTORE_JOURNAL_FILE}.tmp-")` or an equivalent shared private test helper. Preserve fallible enumeration, the four fault injections, fired-count and byte/hash assertions, successful replacement and fixture cleanup. Do not weaken or change production journal behavior.

## R2 — P3: stale current summaries and an incorrect lint log citation

These are evidence/documentation corrections, not current lint or recovery failures:

- `docs/backup-format.md:91` still says directory listing denial removes the plan and return-failure evidence is missing, while its section 7.5 and STATUS describe those as fixed. The latest independent results confirm those functional fixes.
- STATUS and section 7.5 claim zero surviving temporary siblings based on the test with the wrong prefix. Qualify that claim until R1 is corrected and verified.
- The handoff labels `task-2634.log` as the passing final strict-lint evidence. That file records an earlier four-error `clippy::op_ref` failure. Current source uses the corrected operands, and Codex independently reran strict lint successfully. Cite the actual later passing log or the new independent log; do not silently present the earlier failure log as a pass.
- The handoff's selected-WAL install test still labels an `InstallDbRename(1)` failure before the WAL rename as uninstall of an installed selected WAL. The fixture is now genuine, which is progress, but that boundary itself cannot prove uninstall after WAL installation. Keep the precise install-move wording and cite the existing genuine selected-WAL regression separately when claiming its installed-WAL recovery coverage.
- Calendar independence follows from the scoped clock setup, and the corrected suite passes independently. The handoff lists a 1 October host/scoped run rather than an explicit 6 October run; distinguish a setup guarantee from a separately executed host-date simulation.

Update only current summaries and the new implementation handoff. Keep all seven independent review notes immutable afterward. Preserve the explicit best-effort Unix directory-sync contract and the fact that Windows file/fault tests do not prove Unix crash durability.

## Independent evidence

Evidence directory: `C:\Users\ricky\Documents\Codex\2026-09-06\continue-work-on-my-private-github\outputs`.

| Check | Result | Log |
| --- | --- | --- |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml backup::tests:: -- --nocapture` | Exit 0; 143 passed, 0 failed, 0 ignored; 30.75 s test duration | `restore-review-round7-2026-10-01-existing-tests.log` |
| `npx vitest run src/pages/FlightJournal/debriefLinks.test.ts` | Exit 0; 12 passed; 5.86 s total | `restore-review-round7-2026-10-01-debrief-tests.log` |
| `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Exit 0; no warnings; 0.93 s reported | `restore-review-round7-2026-10-01-clippy.log` |
| Guarded temporary seeded-leftover check of `task4_prior_canonical_journal_preserved_on_write_sync_rename_failures`, exact filter | Exit 0; 1 passed despite the seeded leftover; 0.04 s tests, 26.00 s compilation | `restore-review-round7-2026-10-01-oracle-reproduction.log` |

The oracle reproduction script and exact source snapshot are saved as `reproduce-restore-review-round7-2026-10-01.ps1` and `restore-review-round7-2026-10-01-original-backup.rs`. The snapshot is the reviewed 33DF source, not a permanent patch.

The implementer's saved `task-2674.log` confirms 594 frontend tests passed/4 skipped; `task-2684.log` confirms 261 Rust tests passed/6 ignored. Those complete runs were reported by the implementer and inspected, not independently rerun. Build/npm-ci/fmt/lock/version success was reported with terminal-only evidence. No full matrix or CI was repeated after finding R1; independent checks were sequential, without overlapping matrices.

## Next action and limits

Make the small test-oracle correction, demonstrate the negative control, reconcile current summaries and log citations, complete one final local gate, then return the uncommitted branch for acceptance. No further broad restore redesign is requested.

Physical Apple Silicon/macOS 12, installed Windows, live Gemini, native Unix durability and the exact future candidate remain **UNVERIFIED**. The frozen private v0.5.3 DMG cannot certify source changes. This scoped review is not release approval.
