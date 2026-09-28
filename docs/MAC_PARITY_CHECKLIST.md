# macOS parity and implementation tracker

_Last updated: 27 September 2026. Target: Apple Silicon Macs, macOS 12 or newer. Living checklist; not a claim of release readiness._

## Purpose and current position

Keep the Mac app at the same functional and usability level as Windows as shared development progresses. Use the same product and shared code; add platform-specific implementations only where needed. A Windows fix is a candidate Mac improvement, not proof of Mac behavior.

The repository declares minimum macOS 12.0 and bundle identifier `com.herflightdeck.app`. The historical Mac audit records an Apple Silicon package build on an older commit. That does not validate the current branch, an installed application, or macOS 12 runtime support. Current installed Mac behavior and Mac performance remain **UNVERIFIED**.

D6 is committed at `d6e2ec3` on `feature/m1-d6-debrief-links`. D7 acceptance and subsequent polish were added on the same branch and reviewed by Codex. Installed Mac validation and release approval remain open.

## How to maintain this list

For every shared feature, fix, dependency change, permission change, or performance improvement:

1. Add or update an item below with the change's commit/PR and Windows evidence.
2. Decide whether it needs shared code, Mac-specific code, Mac testing, or all three. Do not assume a reported issue still needs implementation without inspecting current code.
3. Record the exact Mac build, hardware, OS, test data, result, and evidence. Keep failures and limitations visible.
4. Mark an item verified only for the environment actually tested. Reopen relevant items when later changes invalidate their evidence.
5. Link the resulting test note here and summarize material blockers in `STATUS.md`. Keep historical audit notes intact.

States: **UNVERIFIED** (not demonstrated on Mac), **TODO** (work identified), **IN PROGRESS**, **BLOCKED** (name dependency), **VERIFIED** (linked exact-build evidence), **NOT APPLICABLE** (explain why). A successful package build is only packaging evidence. Automated tests and installed-app tests must be recorded separately.

## References and precedence

- [Current project status](../STATUS.md)
- [Product roadmap](../ROADMAP.md)
- [Historical macOS audit](MAC_AUDIT_2026-09-12.md)
- [Earlier usability/performance polish](APP_POLISH_2026-09-12.md)
- [D7 acceptance and platform limitations](M1_D7_ACCEPTANCE_2026-09-27.md)
- [Performance and usability polish, 27 September 2026](PERFORMANCE_POLISH_2026-09-27.md)

Historical notes describe their own commits. Reinspect current migrations, backup versions, credentials, permissions, and models instead of copying old implementation claims. This tracker complements the roadmap; it does not authorize iOS work, new features, or release publication.

## Priority 0: installation, storage, and data safety

All installed-Mac checks below start UNVERIFIED. Existing shared fixes should be tested before rewriting them.

| ID | Area and required result | Next work / evidence needed | State |
| --- | --- | --- | --- |
| MAC-01 | Apple Silicon DMG installs and launches from Applications | Build exact candidate; verify executable architecture, Info.plist minimum OS and identifier; install on a synthetic profile; retain DMG SHA-256 | UNVERIFIED |
| MAC-02 | First launch has an understood signing/Gatekeeper path | Inspect signing and notarization status; reproduce any damaged-app warning; document accurate user instructions. Do not disable system protections or assume a damaged warning is harmless | UNVERIFIED |
| MAC-03 | Promised macOS 12+ support works at runtime | Test minimum supported OS and a current macOS on Apple Silicon; record each separately. A newer runner cannot certify macOS 12 | UNVERIFIED |
| MAC-04 | Imported documents survive removal of the original upload | Import via native panel, rename/move original, restart, open managed copy; check spaces, Unicode and long names; cancel/replacement/failure leave no accidental orphans | UNVERIFIED |
| MAC-05 | Study Library Open uses the default PDF viewer | Recheck opener capabilities and resolved app-owned path; install and open in default viewer (Preview when default); reproduce prior 'Not allowed to open path' case | UNVERIFIED |
| MAC-06 | Reveal and Settings Open folder work in Finder | Reveal selects the correct file; folder button opens exactly the displayed app-data directory; permissions remain narrowly scoped | UNVERIFIED |
| MAC-07 | Complete backups finalize safely in Downloads | Export during autosave/split activity; bounded busy handling; validate final archive and document hashes; success only after finalization; failed replacement preserves prior valid backup | UNVERIFIED |
| MAC-08 | Restore and update preserve all supported data | Restore supported legacy/current formats into isolated data; verify records, attachments, practice content, provenance and operation ledger; test failed restore rollback and update over earlier data | UNVERIFIED |
| MAC-09 | Automatic splitting is safe and usable | Long and image-heavy PDFs; each part at most 50 MiB and 1,000 pages; labels, separate library records and per-part study actions; unchanged original hash; no partial files/records after failure | UNVERIFIED |
| MAC-10 | Manual splitting is a reliable fallback | First/last page and optional title; invalid/fractional ranges and oversized output rejected; safety backup; rollback and cleanup; progress remains responsive | UNVERIFIED |
| MAC-11 | Concurrent writes do not produce data loss | Exercise autosave, debrief save, splitting and backup together; verify bounded lock handling, clear failures, retries without duplicates, durable committed results | UNVERIFIED |

## Priority 1: feature parity and smooth operation

| ID | Area and required result | Next work / evidence needed | State |
| --- | --- | --- | --- |
| MAC-12 | Daily Flight Plan matches shared behavior | Budgets, Why, Start, skip/defer, local-date boundaries and restart persistence; keyboard operation | UNVERIFIED |
| MAC-13 | Quick/full debrief and linked records work together | Preserve flight-log fields and drafts; explicit action/question acceptance; completion/answers survive edits and retries; source deletion labels remain honest; restart and restore | UNVERIFIED |
| MAC-14 | Study Library search/filter/sort stays responsive | Small and large synthetic libraries; typing, scrolling, opening, selection and navigation; verify any pagination/virtualization keeps results and accessibility correct | UNVERIFIED |
| MAC-15 | Guides, flashcards and practice tests work from managed files | Explicit selected-file submission; prevent duplicate/concurrent generation across navigation; stale results never overwrite another material; accurate busy/429/failure states | UNVERIFIED |
| MAC-16 | Credentials remain protected | Inspect current storage and entry path; no credential in logs, persisted frontend state, status responses, backups or exports. Historical audit noted transient webview key entry: reassess and document honestly; native secure entry needs a separate decision if strict zero-webview exposure is required | UNVERIFIED |
| MAC-17 | Native Mac interactions are appropriate | Open/save panel cancel and overwrite behavior; Downloads default; Cmd shortcuts and text editing; focus, trackpad, scrolling, Retina, VoiceOver, reduced motion and compact windows | UNVERIFIED |
| MAC-18 | Settings explain Mac behavior clearly | Review every setting for applicable Mac notes: paths, Finder, backups, permissions, updates, credentials; omit irrelevant terminal/developer steps for normal users | TODO |
| MAC-19 | Local workflows work without a network | With networking disabled or independently blocked, run plan, journal, library, splitting and backup/restore; Gemini fails clearly when explicitly requested. A source search for reqwest is not offline proof | UNVERIFIED |
| MAC-20 | Long operations remain predictable across app lifecycle | Navigation, background/foreground, sleep/wake, quit/relaunch; no false success, duplicate jobs, lost edits or unsafe cancellation | UNVERIFIED |
| MAC-21 | Other existing sections retain parity | Notes, Questions (including current paging work if accepted), Schedule, goals, finances and toolkit: navigation, edits, validation, persistence and keyboard behavior | UNVERIFIED |
| MAC-22 | Questions answer save race and pending ownership | On installed Mac, verify answer save: synchronous in-flight guard (`savingQuestionIdsRef`) prevents duplicate submissions from rapid clicks within one render/batch, disabled conflicting controls ('Saving…', Cancel, TextArea), pending state surviving filter changes/paging unmount, and revision ownership preserving newer edits | UNVERIFIED |

## Priority 2: Mac performance measurements

Do not carry Windows speedup percentages over to Mac. Compare the same workload before/after on the same Mac, using synthetic data and the same measurement method. Record cold and warm runs separately, repeat a small fixed number of times, and report variability. Separate frontend development measurements from packaged application results.

| ID | Measure | Required context / checks | State |
| --- | --- | --- | --- |
| PERF-MAC-01 | Launch to usable screen; first/repeated navigation | Chip, RAM, OS, build SHA/mode; wall time, peak memory, loading/layout behavior | UNVERIFIED |
| PERF-MAC-02 | Large-library search, filter, sort and scrolling | Record count, query, render/interaction latency, long tasks and memory; result correctness unchanged | UNVERIFIED |
| PERF-MAC-03 | PDF import and automatic/manual splitting | Exact bytes/pages and fixture hash, image-heavy vs long text PDF; elapsed time, memory, UI responsiveness and equivalent output | UNVERIFIED |
| PERF-MAC-04 | Complete backup and restore | Database/document counts and sizes, free disk space, concurrent workload, duration and integrity; no faster-but-unsafe success | UNVERIFIED |
| PERF-MAC-05 | Gemini preparation/request/save lifecycle | Separate local work from network/model latency; record model/configuration without key; no live paid benchmarking without authorization | UNVERIFIED |
| PERF-MAC-06 | Sustained use and cleanup | Repeat navigation/import/cancel/generation flows; listener, memory and resource growth; app remains responsive | UNVERIFIED |

## Current development carry-forward log

Append a row whenever Windows/shared work affects Mac behavior. Replace provisional descriptions with reviewed commits and exact evidence as work lands.

| Shared work | Current evidence | Mac follow-up | Commit / Mac evidence |
| --- | --- | --- | --- |
| Earlier route loading, compact navigation, import cleanup and PDF dialog guards | Historical polish note linked above | Verify actual native layout, panels, cleanup and responsiveness | See historical note; current Mac result pending |
| PDF windowing and backup/database safety work | Shared tests and earlier notes; current code must be reinspected | Image-heavy/long PDF profiling, contention and restore on installed Mac | Pending exact candidate |
| D6 atomic debrief save and durable links | Reviewed committed work `d6e2ec3`; shared/native tests | MAC-08, MAC-11, MAC-13 | Installed Mac pending |
| D7 workflow, upgrade and backup acceptance | Added tests; see D7 note for independent checks and limitations | Repeat relevant scenarios through installed Mac UI | Final commit pending |
| Questions: 100-row paging with "Show more", and linked material/lesson/debrief looked up by id ([note §5.1](PERFORMANCE_POLISH_2026-09-27.md)) | Shared automated: `Questions.paging.test.ts` (whole-list filters, every question reachable, correct links). Windows development measurements only: jsdom 531 → 63 ms (800 questions); Chromium browser mode 595 → 62 ms. No Windows installed-app check. | MAC-21 (Questions parity), PERF-MAC-01 (navigation), PERF-MAC-02 (long lists): open, page, filter and keyboard-operate a long question list on an installed Mac; measure on the Mac itself. Windows speedups don't carry over. | Shared branch reviewed; Mac UNVERIFIED |
| Questions: unsaved answers kept by question id across paging, filters and new records; explicit Cancel/save/failure rules; every filter change resets to 100 rows ([note §5.1a](PERFORMANCE_POLISH_2026-09-27.md)) | Shared automated: `Questions.drafts.test.ts` (8 tests; 4 failed on the earlier code). No Windows installed-app check. | MAC-21, MAC-20 (no lost edits across navigation and lifecycle), MAC-17 (keyboard and text editing): type an answer, add a question, change filters, Show more, then save, cancel and fail on an installed Mac | Shared branch reviewed; Mac UNVERIFIED |
| Questions: answer-save race resolved with per-question save ownership, monotonic revisions, synchronous ref in-flight guard (`savingQuestionIdsRef`) preventing duplicate submissions within one render batch, disabled conflicting controls ('Saving…', Cancel, TextArea, Select, Delete), and pending state surviving filter remounts ([note §5.1b](PERFORMANCE_POLISH_2026-09-27.md)) | Shared automated: `Questions.drafts.test.ts` (14 tests passed, including controlled-promise batch regression tests). No Windows installed-app check. | MAC-22, MAC-21, MAC-20: on installed Mac, verify delayed-save behaviour: start answer save, verify controls disable ('Saving…', Cancel, editor), rapid double click in single batch produces 1 write, filter away and back retains pending state, newer edits/sessions survive older completions | Shared branch reviewed; Mac UNVERIFIED |
| Complete-backup restore hashes each file while writing it instead of reopening it; same size, SHA-256 and `sync_all` checks ([note §5.2](PERFORMANCE_POLISH_2026-09-27.md)) | Shared native automated: `restored_files_are_hashed_from_exactly_the_bytes_written` plus the existing backup tests (45 passed, 1 ignored benchmark). Windows release benchmark: restore 6,856 → 1,142 ms (5,000 records, 300 files). The cost was per-file reopen latency on this Windows machine and may differ on macOS. | MAC-08 (restore preserves data), PERF-MAC-04 (backup and restore timing): time and verify a large restore on an installed Mac, including a failed-restore rollback | Shared branch reviewed; Mac UNVERIFIED |
| Compact navigation (≤ 900 px) no longer widens the page; screen-reader label contained in the nav scroll area ([note §5.3](PERFORMANCE_POLISH_2026-09-27.md)) | Chromium browser-mode measurement on Windows (824 → 470 px document width at 470 px); `shell.css.test.ts` is a source guard only | MAC-17 (compact windows, VoiceOver): narrow the window on an installed Mac; check for no sideways page scroll, that the nav scrolls on its own, and that VoiceOver reads the Questions count | Shared branch reviewed; Mac UNVERIFIED |
| Benchmarks added (ignored or gated, run by hand): `src/perf/appResponsiveness.bench.test.ts` (`HFD_BENCH=1`), `pdf::tests::split_benchmark_long_and_image_heavy`, `pdf::tests::gemini_local_preparation_benchmark`, `debrief::tests::complete_backup_benchmark_large_library` | Windows results in the note §4. PDF splitting and Gemini local preparation were not bottlenecks there. | Rerun the same benchmarks on the Mac for PERF-MAC-02, PERF-MAC-03 (MAC-09/MAC-10 splitting), PERF-MAC-04 and PERF-MAC-05 (local preparation only; no live requests without authorization). PDF import timing wasn't measured on either platform. | Shared branch reviewed; Mac UNVERIFIED |

## Mac execution sequence

- [ ] Obtain an Apple Silicon Mac and a separate OS test account or spare machine with synthetic data. Preserve real user data. Do not assume an environment-variable override isolates Tauri's data directory.
- [ ] Select the reviewed exact commit/candidate and record its version. Do not distribute a retired 0.5.2 build. Keep existing published releases/tags untouched.
- [ ] Install development prerequisites only on the build machine; document the actual toolchain. End users should follow packaged installation instructions, not development setup.
- [ ] From the repository root run `npm ci`, `npm test`, `npm run build`.
- [ ] From `src-tauri` run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- [ ] Build a candidate DMG from the root with `npm run tauri build -- --bundles dmg`; inspect the actual bundle, architecture and minimum OS. Only build an approved non-retired candidate version; version preparation stays a separate reviewed step.
- [ ] Install that exact artifact and execute Priority 0, then Priority 1 and performance checks. Record command output and UI results separately.
- [ ] Test current and minimum supported macOS; list any unavailable OS coverage explicitly.
- [ ] Reproduce failures, make the smallest safe fix, add focused regression tests and preserve Windows coverage. Run the final matrix once after corrections.
- [ ] Perform Questions delayed-save smoke test (MAC-22): open answer editor, start save under simulated latency, verify synchronous guard and disabled controls prevent duplicate submissions on rapid clicks within a render batch, verify Cancel cannot be used as a false rollback, verify filter away and back preserves pending state, and verify newer edits survive older completions.
- [ ] Review evidence and update this tracker/STATUS. A green CI build alone does not close installed-app items or authorize release.

## Evidence record template

Copy for each item or grouped run:

```text
Item IDs:
Tester / date:
State (before -> after):
Commit / PR / clean-or-dirty tree:
App version / DMG SHA-256:
Mac model / chip / RAM / macOS:
Build mode / toolchain:
Isolated profile and synthetic fixture details:
Steps and expected result:
Actual result / failure reproduction:
Automated commands and exit results:
Measurements (method, runs, variation):
Logs/screenshots/test-note links (redact secrets):
Remaining limitations / next action / owner:
```

## Completion and release gate

Mac parity requires evidence for the shipped feature set on the exact candidate, not merely code shared with Windows. Close Priority 0 blockers; address Priority 1 failures or explicitly defer nonblocking work with reasons; record performance evidence and remaining limits. Verify backup/restore, migration, permissions and credentials before distribution. Windows clearance and platform release holds remain tracked in STATUS.md; this document does not remove them. iOS is a separate target and is not certified by Mac testing.
