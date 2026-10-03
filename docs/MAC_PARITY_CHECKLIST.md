# macOS parity and implementation tracker

_Last updated: 29 September 2026 (Mac test kit prepared for 2 October 2026). Target: Apple Silicon Macs, macOS 12 or newer. Living checklist; not a claim of release readiness._

**2 October handoff:** the user has a Mac available. Start with the [GitHub Mac handoff](MAC_GITHUB_HANDOFF_2026-10-02.md) and record hardware/OS evidence before changing any UNVERIFIED result. The frozen-candidate kit below remains a separate artifact test; a fresh build of current main cannot be recorded as that candidate.

## Purpose and current position

**3 October structured-import Slice A interruption:** the [owner exception](STRUCTURED_STUDY_IMPORT_SLICE_A_OWNER_EXCEPTION_2026-10-03.md) permits only validator/read-only picker source work. Source remains local/uncommitted, with 241 focused frontend tests, typecheck and 16 native tests independently passing. [Codex review](STRUCTURED_STUDY_IMPORT_SLICE_A_INTERRUPTION_REVIEW_2026-10-03.md) identifies SA1 in the mutation runner; [Gemini finishes](GEMINI_STRUCTURED_STUDY_IMPORT_SLICE_A_FINISH_PROMPT_2026-10-03.md) testing and the handoff. Source integration is pending. No installed, older-macOS, Windows or release item is cleared.

**Owner decision (2 October):** Mac is the primary user platform. [The Mac-first readiness plan](MAC_PRIMARY_DEVELOPMENT_PLAN_2026-10-02.md) requires actual installed validation after source consolidation and signing; existing UNVERIFIED item states remain unchanged.

**2 October physical source evaluation:** [Observed Mac report](MAC_SMOKE_RESULTS_2026-10-02.md) records Apple M5 / 32 GB / macOS 26.6 and passing frontend/native source checks at main `5e388bf4169c7f968b1581292d6e1a24aa0493da`, with explicit installed SDK 26.5 after a default-SDK linker failure. Local Apple Silicon evaluation DMG build passed; its packaged app has an ad hoc signature, fails command-line Gatekeeper assessment, and has no stapled ticket. Installed smoke tests remain pending a dedicated standard test account. These results do not change the installed-Mac item states or frozen candidate identity below.

Keep the Mac app at the same functional and usability level as Windows as shared development progresses. Use the same product and shared code; add platform-specific implementations only where needed. A Windows fix is a candidate Mac improvement, not proof of Mac behavior.

The repository declares minimum macOS 12.0 and bundle identifier `com.herflightdeck.app`. Candidate source is synchronized to `0.5.3`. The private, unpublished v0.5.3 Apple Silicon DMG was built via GitHub Actions `macos-15` (workflow run `36515016063`, target commit `41464607ff85d0a4cf0b837c19b400d8392dfec4`) and its checksum verified against `SHA256SUMS.txt` (`Her.Flight.Deck_0.5.3_aarch64.dmg`, 4,511,142 bytes, SHA-256 `de81be50122275104ca9e6791162a7bac6cd43a672c5580d5fbc509b5d16efec`).

> [!IMPORTANT]
> **Packaging evidence vs. Mac release readiness:**
> A successful CI build and verified checksum manifest constitute **packaging evidence only**. No physical Mac installation, launch, or smoke test has been performed. All physical Mac installation, launch, security, feature, and performance items remain completely **UNVERIFIED**. The private draft remains strictly unpublished, and `refs/tags/v0.5.3` does not exist in the Git repository (created only upon draft publication).

D6 is committed at `d6e2ec3` on `feature/m1-d6-debrief-links`. D7 acceptance and subsequent polish merged through PR #35 (`1d86d57`). Installed Mac validation and release approval remain open.

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
- [Independent full audit — 29 September 2026](FULL_REPOSITORY_AUDIT_2026-09-29.md)
- [Third restore-safety review — current A1 blockers](RESTORE_RETENTION_THIRD_REVIEW_2026-09-30.md)
- [Fourth restore-safety review — latest A1 decision](RESTORE_RETENTION_FOURTH_REVIEW_2026-09-30.md)
- [M2 Study Library design (planning only)](M2_STUDY_LIBRARY_DESIGN_2026-09-27.md)
- [Product roadmap](../ROADMAP.md)
- [Historical macOS audit](MAC_AUDIT_2026-09-12.md)
- [Earlier usability/performance polish](APP_POLISH_2026-09-12.md)
- [D7 acceptance and platform limitations](M1_D7_ACCEPTANCE_2026-09-27.md)
- [Performance and usability polish, 27 September 2026](PERFORMANCE_POLISH_2026-09-27.md)

Historical notes describe their own commits. Reinspect current migrations, backup versions, credentials, permissions, and models instead of copying old implementation claims. This tracker complements the roadmap; it does not authorize iOS work, new features, or release publication.

## Priority 0: installation, storage, and data safety

All installed-Mac checks below start UNVERIFIED. Existing shared fixes should be tested before rewriting them.

Current source-review OS: `sw_vers` confirms macOS 27.0.1 (26A434); SDK 26.5 still works for native checks. Earlier 26.6/DMG/signing records retain their historical identity and do not establish a current installed pass. [A5 next step](CLAUDE_MAC_A5_EVIDENCE_RECONCILIATION_PROMPT_2026-10-02.md) verifies existing tooling and reconciles remaining evidence.

| ID | Area and required result | Next work / evidence needed | State |
| --- | --- | --- | --- |
| MAC-01 | Apple Silicon DMG installs and launches from Applications | Build exact candidate; verify executable architecture, Info.plist minimum OS and identifier; install on a synthetic profile; retain DMG SHA-256 | UNVERIFIED |
| MAC-02 | First launch has an understood signing/Gatekeeper path | Inspect signing and notarization status; record exact macOS dialog text, icon, and buttons; investigate root causes through Developer ID signing and notarization. Never advise 'Open Anyway' or Control-click Open; never disable Gatekeeper or run quarantine clearing commands (`xattr -d`) | UNVERIFIED |
| MAC-03 | Promised macOS 12+ support works at runtime | Test minimum supported OS and a current macOS on Apple Silicon; record each separately. A newer runner cannot certify macOS 12. A3 source fallbacks for `structuredClone`, modal `<dialog>` and `randomUUID` are source-accepted with capability-removal tests ([report](MAC_A3_COMPATIBILITY_IMPLEMENTATION_2026-10-02.md)); on installed 12.0–12.2, check toolkit start, Dialog/Quick Find keyboard, pointer and VoiceOver, and new records | UNVERIFIED |
| MAC-04 | Imported documents survive removal of the original upload | Import via native panel, rename/move original, restart, open managed copy; check spaces, Unicode and long names; cancel/replacement/failure leave no accidental orphans | UNVERIFIED |
| MAC-05 | Study Library Open uses the default PDF viewer | Recheck opener capabilities and resolved app-owned path; install and open in default viewer (Preview when default); reproduce prior 'Not allowed to open path' case | UNVERIFIED |
| MAC-06 | Reveal and Settings Open folder work in Finder | Reveal selects the correct file; folder button opens exactly the displayed app-data directory; permissions remain narrowly scoped | UNVERIFIED |
| MAC-07 | Complete backups finalize safely in Downloads | Export during autosave/split activity; bounded busy handling; validate final archive and document hashes; success only after finalization; failed replacement preserves prior valid backup | UNVERIFIED |
| MAC-08 | Restore and update preserve all supported data | Restore supported legacy/current formats into isolated data; verify records, attachments, practice content, provenance and operation ledger; test failed restore rollback and update over earlier data. [A1 shared acceptance](RESTORE_RETENTION_ACCEPTANCE_2026-10-01.md): final 18 focused cases pass independently, with 144 backup tests passing in the inspected complete log. Includes the corrected real-prefix temporary-sibling negative control. Unix directory sync is best-effort. Exact new-candidate installed Mac behavior remains unverified. | Mac UNVERIFIED; shared A1 source/regression repair accepted |
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
| MAC-18 | Settings explain Mac behavior clearly | All 8 cards reviewed in source: Application Support paths, Finder reveal, Downloads/iCloud backups, platform security and credential safety notes present (with 'Open Anyway' / Control-click references removed); code-level checks passed; installed-app visual and interaction check pending | UNVERIFIED |
| MAC-19 | Local workflows work without a network | With networking disabled or independently blocked, run plan, journal, library, splitting and backup/restore; Gemini fails clearly when explicitly requested. A source search for reqwest is not offline proof. A4 source fix (independently accepted for publication): saved guides, flashcards and practice tests render without Gemini, network or an eligible source, with no submission while reading ([report](MAC_A4_OFFLINE_STUDY_IMPLEMENTATION_2026-10-02.md)); confirm in the installed app with networking disabled and Gemini disconnected. | UNVERIFIED |
| MAC-20 | Long operations remain predictable across app lifecycle | Navigation, background/foreground, sleep/wake, quit/relaunch; no false success, duplicate jobs, lost edits or unsafe cancellation | UNVERIFIED |
| MAC-21 | Other existing sections retain parity | Notes, Questions (including current paging work if accepted), Schedule, goals, finances and toolkit: navigation, edits, validation, persistence and keyboard behavior | UNVERIFIED |
| MAC-22 | Questions answer save race and pending ownership | On installed Mac, verify answer save: synchronous in-flight guard (`savingQuestionIdsRef`) prevents duplicate submissions from rapid clicks within one render/batch, disabled conflicting controls ('Saving…', Cancel, TextArea), pending state surviving filter changes/paging unmount, and revision ownership preserving newer edits | UNVERIFIED |

## Priority 2: Mac performance measurements

Do not carry Windows speedup percentages over to Mac. Compare the same workload before/after on the same Mac, using synthetic data and the same measurement method. Record cold and warm runs separately, repeat a small fixed number of times, and report variability. Separate frontend development measurements from packaged application results.

| ID | Measure | Required context / checks | State |
| --- | --- | --- | --- |
| PERF-MAC-01 | Launch to usable screen; first/repeated navigation | Chip, RAM, OS, build SHA/mode; wall time, peak memory, loading/layout behavior | UNVERIFIED |
| PERF-MAC-02 | Large-library search, filter, sort and scrolling | Record count, query, render/interaction latency, long tasks and memory; result correctness unchanged | Source-level Node/jsdom baseline recorded on this Mac ([report](MAC_STUDY_LIBRARY_BASELINE_2026-10-02.md)). Every step is verified against the answer key; displays measured at 100, 200 and up to 1,000 cards; no scrolling or paint; displays above 1,000 unmeasured. Installed WKWebView: UNVERIFIED |
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
| D6 atomic debrief save and durable links | Merged through PR #35 (`1d86d57`); shared/native tests | MAC-08, MAC-11, MAC-13 | Installed Mac pending |
| D7 workflow, upgrade and backup acceptance | Merged through PR #35 (`1d86d57`); see D7 note for checks and limitations | Repeat relevant scenarios through installed Mac UI | Mac UNVERIFIED |
| Questions: 100-row paging with "Show more", and linked material/lesson/debrief looked up by id ([note §5.1](PERFORMANCE_POLISH_2026-09-27.md)) | Shared automated: `Questions.paging.test.ts` (whole-list filters, every question reachable, correct links). Windows development measurements only: jsdom 531 → 63 ms (800 questions); Chromium browser mode 595 → 62 ms. No Windows installed-app check. | MAC-21 (Questions parity), PERF-MAC-01 (navigation), PERF-MAC-02 (long lists): open, page, filter and keyboard-operate a long question list on an installed Mac; measure on the Mac itself. Windows speedups don't carry over. | Merged in PR #35; Mac UNVERIFIED |
| Questions: unsaved answers kept by question id across paging, filters and new records; explicit Cancel/save/failure rules; every filter change resets to 100 rows ([note §5.1a](PERFORMANCE_POLISH_2026-09-27.md)) | Shared automated: `Questions.drafts.test.ts` (8 tests; 4 failed on the earlier code). No Windows installed-app check. | MAC-21, MAC-20 (no lost edits across navigation and lifecycle), MAC-17 (keyboard and text editing): type an answer, add a question, change filters, Show more, then save, cancel and fail on an installed Mac | Merged in PR #35; Mac UNVERIFIED |
| Questions: answer-save race resolved with per-question save ownership, monotonic revisions, synchronous ref in-flight guard (`savingQuestionIdsRef`) preventing duplicate submissions within one render batch, disabled conflicting controls ('Saving…', Cancel, TextArea, Select, Delete), and pending state surviving filter remounts ([note §5.1b](PERFORMANCE_POLISH_2026-09-27.md)) | Shared automated: `Questions.drafts.test.ts` (14 tests passed, including controlled-promise batch regression tests). No Windows installed-app check. | MAC-22, MAC-21, MAC-20: on installed Mac, verify delayed-save behaviour: start answer save, verify controls disable ('Saving…', Cancel, editor), rapid double click in single batch produces 1 write, filter away and back retains pending state, newer edits/sessions survive older completions | Merged in PR #35; Mac UNVERIFIED |
| Complete-backup restore hashes each file while writing it instead of reopening it; same size, SHA-256 and `sync_all` checks ([note §5.2](PERFORMANCE_POLISH_2026-09-27.md)) | Shared native automated: `restored_files_are_hashed_from_exactly_the_bytes_written` plus the existing backup tests (45 passed, 1 ignored benchmark). Windows release benchmark: restore 6,856 → 1,142 ms (5,000 records, 300 files). The cost was per-file reopen latency on this Windows machine and may differ on macOS. | MAC-08 (restore preserves data), PERF-MAC-04 (backup and restore timing): time and verify a large restore on an installed Mac, including a failed-restore rollback | Merged in PR #35; Mac UNVERIFIED |
| Compact navigation (≤ 900 px) no longer widens the page; screen-reader label contained in the nav scroll area ([note §5.3](PERFORMANCE_POLISH_2026-09-27.md)) | Chromium browser-mode measurement on Windows (824 → 470 px document width at 470 px); `shell.css.test.ts` is a source guard only | MAC-17 (compact windows, VoiceOver): narrow the window on an installed Mac; check for no sideways page scroll, that the nav scrolls on its own, and that VoiceOver reads the Questions count | Merged in PR #35; Mac UNVERIFIED |
| Benchmarks added (ignored or gated, run by hand): `src/perf/appResponsiveness.bench.test.ts` (`HFD_BENCH=1`), `pdf::tests::split_benchmark_long_and_image_heavy`, `pdf::tests::gemini_local_preparation_benchmark`, `debrief::tests::complete_backup_benchmark_large_library` | Windows results in the note §4. PDF splitting and Gemini local preparation were not bottlenecks there. | Rerun the same benchmarks on the Mac for PERF-MAC-02, PERF-MAC-03 (MAC-09/MAC-10 splitting), PERF-MAC-04 and PERF-MAC-05 (local preparation only; no live requests without authorization). PDF import timing wasn't measured on either platform. | Merged in PR #35; Mac UNVERIFIED |
| Failed-restore rollback retention and startup safety (A1 audit repair) | [Shared source/regression repair accepted](RESTORE_RETENTION_ACCEPTANCE_2026-10-01.md): final 18 focused cases pass independently; inspected complete logs show 262 Rust tests passing, including 144 backup tests. | MAC-08: test active/recovery/staging/pending roots and symlinks, complete manifests, genuine committed WAL-only rows, interrupted protection/install/return moves and journal failures, cleanup inspection errors and repeated launch on an approved exact new candidate. The frozen v0.5.3 DMG cannot prove these source repairs. | Shared repair accepted; exact-head CI required for merge; Mac UNVERIFIED |
| Study Library benchmark corrections and baseline ([report](MAC_STUDY_LIBRARY_BASELINE_2026-10-02.md), R1–R3 corrected) | Mac Node/jsdom only (Apple M5, macOS 26.6, base `a4339fc` plus local diff): 100/1,000/5,000 plus 10,000 stress. Search compute ≤ 1.54 ms per state at 5,000. About 9–20 ms per interaction at 100 shown. Show more grows with displayed cards (about 97 ms per click at 1,000). Edit plus refresh 20 ms at 5,000. File status mocked. | PERF-MAC-01/02 installed WKWebView keypress-to-paint, launch, peak RSS **and expanded displays** (W1/W2 in the report), on a dedicated test account with an acceptable signing state, after Codex review | [Source/evidence accepted by Codex](MAC_STUDY_LIBRARY_BASELINE_ACCEPTANCE_2026-10-02.md); exact-head CI merge gate; installed Mac UNVERIFIED |
| A3 WebKit compatibility ([report](MAC_A3_COMPATIBILITY_IMPLEMENTATION_2026-10-02.md)) | Source tests on the Mac in Node/jsdom with APIs removed: toolkit copy/factory without `structuredClone`; shared modal fallback when `showModal`/`close` are missing (focus, Tab, Escape/backdrop requests, focus return, background exclusion, layering, StrictMode); UUID v4 from `getRandomValues` without `randomUUID`. 37 tests; negative control against the original source 34 failed / 3 passed. Codex A3-R1–R3 modal-stack corrections (top-only exclusion, live-stack layering, validated focus chain) and A3-R4 (body-level fallback portal for nested lifetime) add 16 regressions. Local gate green (655 / 246). | MAC-03, MAC-17: installed macOS 12.0–12.2 (fallback path) and current macOS (native path): fresh toolkit, Dialog and Quick Find with keyboard, pointer and VoiceOver, new-record ids; Windows WebView2 regression | [A3-R1–R4 source accepted](MAC_A3_COMPATIBILITY_ACCEPTANCE_2026-10-02.md); merged in PR #48; installed Mac UNVERIFIED |
| A4 saved study content offline ([report](MAC_A4_OFFLINE_STUDY_IMPLEMENTATION_2026-10-02.md)) | Source tests on the Mac (jsdom, real SQLite, `fetch` and Gemini calls spied): saved guide, cards and practice test usable with Gemini disconnected, loading or failed, and with a missing, unsupported, oversized or detached source; regeneration gated with notices; old content kept through failed regeneration; cross-material lock view. 11 tests; negative control 9 failed / 2 passed. Local gate green (666 / 246). | MAC-19 (no network), MAC-17 (VoiceOver reading of notices): installed app with networking disabled and Gemini disconnected; read the guide, flip cards, take the saved test | [Source accepted](MAC_A4_OFFLINE_STUDY_ACCEPTANCE_2026-10-02.md); merged in PR #49; installed Mac UNVERIFIED |
| A6 Gemini retry wording ([report](MAC_A6_RETRY_WORDING_IMPLEMENTATION_2026-10-02.md)) | Rust message-contract tests on the Mac (macOS 27.0.1, SDK 26.5): exhausted busy text has no duration; connection-check and single-refusal 429/5xx text claims no backup or retries; retry policy unchanged. 4 tests; negative control 3 failed / 1 guard passed. Local gate green (666 / 250). | PERF-MAC-05 / optional live Gemini (only when explicitly authorized): read the busy, rate-limit and connection-check messages in the installed app | [Source accepted](MAC_A6_RETRY_WORDING_ACCEPTANCE_2026-10-02.md); merged in PR #50; installed Mac UNVERIFIED |
| A5 fixture and archive-check reconciliation ([report](MAC_A5_EVIDENCE_RECONCILIATION_2026-10-02.md)) | No tooling change. On this Mac (macOS 27.0.1): fixtures regenerate with the recorded hashes; Fixture C has 60 distinct, deflate-incompressible images and ordered page IDs; release-safety suite 51 passed / 1 deliberate skip; credential inspector exit 0/1/2 across 9 synthetic cases with no disclosure; native PDF tests 20 passed; opt-in 54 MB split passes (2 parts, ordered IDs, source unchanged; test-process peak RSS ~573 MB, debug build); PDFKit independently confirms pages, IDs and images of sources and split outputs, and detects tampering. Windows-recorded part sizes differ from the Mac's deterministic output. | MAC-09/MAC-10, PERF-MAC-03, MAC-08 credential check: run in the packaged app on a dedicated test account | [Documentation/evidence accepted](MAC_A5_EVIDENCE_ACCEPTANCE_2026-10-03.md) for required CI/merge; installed Mac UNVERIFIED |


## October 2 Mac test kit (non-sensitive synthetic data)

This test kit specifies the exact candidate artifact, isolated profile environment, reproducible non-sensitive synthetic fixtures, and procedural gates for physical testing on an Apple Silicon Mac scheduled for 2 October 2026. All installed-Mac outcomes remain **UNVERIFIED** until physically tested and observed on the target machine.

### 1. Exact candidate artifact & packaging inspection

Under the **Exact-Installer Invariant**, physical testing must be performed on the exact draft DMG matching `SHA256SUMS.txt` from the private GitHub Release draft. Testing a preliminary CI build or a locally rebuilt DMG does not authorize releasing draft bytes: a DMG rebuilt locally from today's `main` is useful for source/build validation and inspecting packaging scripts, but cannot substitute for the draft asset under the exact-installer rule. All physical installation, Gatekeeper checks, smoke testing, and parity measurements must be performed exclusively using the exact downloaded private v0.5.3 draft DMG.

- **Exact draft DMG filename:** `Her.Flight.Deck_0.5.3_aarch64.dmg`
- **File size:** 4,511,142 bytes (4.3 MiB)
- **SHA-256 hash:** `de81be50122275104ca9e6791162a7bac6cd43a672c5580d5fbc509b5d16efec`
- **CI provenance:** Workflow run `36515016063`, targeting commit `41464607ff85d0a4cf0b837c19b400d8392dfec4`
- **Pre-mount checksum verification (macOS Terminal):**
  ```bash
  shasum -a 256 -c SHA256SUMS.txt
  # or verify single file:
  shasum -a 256 Her.Flight.Deck_0.5.3_aarch64.dmg
  ```
  Expected output: `Her.Flight.Deck_0.5.3_aarch64.dmg: OK`.
- **Packaging inspection on downloaded candidate / installed app:**
  The tester must inspect and verify the following on the exact downloaded artifact rather than assuming prior CI claims:
  - Architecture: Inspect binary architecture (`lipo -archs` or `file`) to confirm native `arm64` (Apple Silicon).
  - Bundle identifier: Inspect `Info.plist` to confirm `CFBundleIdentifier` is `com.herflightdeck.app`.
  - Minimum OS version: Inspect `Info.plist` to confirm `LSMinimumSystemVersion` is `12.0`.
  - Code signing and notarization status: Inspect code signature and assessment using `codesign -dv --verbose=4 /Applications/Her\ Flight\ Deck.app` and `spctl -a -vvv /Applications/Her\ Flight\ Deck.app`.

### 2. Isolated-user setup

- **User account:** Use a dedicated standard macOS user account (e.g. `hfd-test` or `HFDTestUser`) on physical Apple Silicon hardware.
- **Storage isolation:** Confirm `~/Library/Application Support/com.herflightdeck.app` is clean prior to testing. Tauri's SQLite path and application storage hardcode the standard OS app config directory (`app.path().app_config_dir()`); environment variable overrides do not redirect storage. A dedicated user account prevents accidental pollution or loss of live flight-training data.
- **Download staging:** Staging directory set to standard `~/Downloads/`.

### 3. Gatekeeper and installation gate (first critical gate)

1. Mount the exact downloaded private v0.5.3 draft DMG (`Her.Flight.Deck_0.5.3_aarch64.dmg`, checksum verified) in Finder. Do not mount or install a locally rebuilt DMG.
2. Drag `Her Flight Deck.app` to `/Applications`.
3. Open `/Applications/Her Flight Deck.app` normally from Finder or Spotlight.
4. **Platform protection rule (Gatekeeper gate):**
   - The first gate is normal installation and launch.
   - If macOS Gatekeeper displays an untrusted developer prompt, code signing refusal, or quarantine warning ("cannot be opened because Apple cannot check it for malicious software" or "damaged and cannot be opened"):
     - **Record the exact dialog:** Window title, full message text, icon, and button labels (e.g., "Cancel", "Move to Trash").
     - **STOP all dependent tests immediately.**
     - **Strict prohibition:** Do **NOT** bypass platform protections. Never advise or click "Open Anyway", never use Control-click Open, never disable Gatekeeper (`spctl --master-disable`), and never run quarantine removal commands (`xattr -d com.apple.quarantine`).
   - If the application launches normally to the first usable screen, record the launch time and proceed.

### 4. Synthetic non-sensitive PDF test fixtures

All fixtures use synthetic, non-confidential flight-training data generated using a reproducible script without external dependencies. Large generated binaries must not be committed to Git. Synthetic image data is a boundary fixture (600×500 RGB raster, 900,000 uncompressed bytes per page), not a realistic scanned handbook; it is designed to safely exceed the 50 MiB threshold for splitting tests without committing large binaries. Independent PDF readers (verified with `pdfjs-dist` / Mozilla PDF.js engine and `pdf-lib` on the Windows host) report the intended page counts (10, 1,050, and 60 pages) and extract text/operator streams from sample pages without syntax or stream parsing errors. On this Mac (macOS 27.0.1), Apple's PDFKit, a system framework separate from lopdf, read all three fixtures and the Fixture C split outputs: every page's `P0001`-style ID was present and consecutive, every illustrated page produced a non-white pixel sample inside the image region of its rendered thumbnail, and swapped or removed pages were detected ([A5 reconciliation](MAC_A5_EVIDENCE_RECONCILIATION_2026-10-02.md)). Source-level Rust tests in `src-tauri/src/pdf.rs` decode each page's embedded `P0001`-style identifier across all split parts and manual ranges to verify complete ordered sequence coverage and reject corrupted or reordered page IDs (distinguishing asserted content identity from bare page counts). PDFKit thumbnail rendering was sampled as described above; full visual inspection in macOS Preview and installed WKWebView remains pending.

#### Fixture generator instructions

Generate the fixtures from the repository root using the shared Node.js generator script into an isolated synthetic output directory (e.g. `/tmp/hfd-fixtures/`):

```bash
mkdir -p /tmp/hfd-fixtures
node scripts/generate-pdf-fixtures.mjs /tmp/hfd-fixtures
```

This single generator script is exercised directly by repository test suites (`src/logic/releaseSafety.test.ts`), eliminating implementation divergence.

#### Generated fixture specifications and pass criteria

| Fixture | Characteristics | Actual Generated Metrics | Pass Criteria (to verify on installed Mac) | Where evidence belongs |
| --- | --- | --- | --- | --- |
| **Fixture A: Small PDF** (`synthetic-small-checklist.pdf`) | Single-chapter reference document (text only) | **10 pages**<br>3,360 bytes<br>`f6c593f9d86de6e83bd476897cde7693a43cb5db785c6afbcf01eb1d8024b134` | Native file picker imports without UI freeze; file copied into `~/Library/Application Support/com.herflightdeck.app/documents/`; original file can be renamed or moved without affecting app copy; clicking "Open" launches default PDF viewer (Preview); clicking "Reveal" opens Finder with the document highlighted; cancellation leaves no orphaned files. | `MAC-04` (Import survival), `MAC-05` (Default viewer Open), `MAC-06` (Finder reveal), `PERF-MAC-03` |
| **Fixture B: Long PDF** (`synthetic-long-manual.pdf`) | Text handbook testing the **1,000-page limit** boundary (well under 50 MiB) | **1,050 pages**<br>330,934 bytes<br>`0ba9a7e2c4b9e14aac2360fc410f5b4a05eab9b2c9ab4b23ea8ab7228f9692c1` | Automatic splitting detects that page count exceeds 1,000 pages; produces 2 child parts providing complete, ordered, non-overlapping coverage of all 1,050 pages. Actual-source Rust extraction measurements on Windows host (candidate Mac build must be verified): Part 1: pages 1–1,000, 315,191 bytes; Part 2: pages 1,001–1,050, 15,901 bytes; each child part is strictly ≤ 1,000 pages and ≤ 50 MiB; manual split (pages 101–300) extracts exactly 200 pages (63,138 bytes); ordered page IDs `P0001`..`P1050` verified in source tests; original source file SHA-256 remains unchanged; separate library records created with per-part study actions. | `MAC-09` (Automatic split), `MAC-10` (Manual split), `PERF-MAC-03` |
| **Fixture C: Image-Heavy PDF** (`synthetic-illustrated-charts.pdf`) | Illustrated document testing the **50 MiB limit** boundary (well under 1,000 pages; 600×500 RGB raster, 900,000 bytes/page) | **60 pages**<br>54,032,644 bytes (51.53 MiB)<br>`b5651eb61a484dbe4876da2ff002d4884f414086080ee061b67f6fec01ab096d` | Imports and splits without out-of-memory (OOM) crash or UI unresponsiveness; automatic splitting recognizes the >50 MiB total byte size and splits into 2 child parts. Actual-source Rust extraction measurements on Windows host (candidate Mac build must be verified): Part 1: pages 1–58, 51,731,349 bytes / 49.33 MiB; Part 2: pages 59–60, 1,784,008 bytes / 1.70 MiB; Mac source-level measurement (macOS 27.0.1, same `pdf.rs`/`Cargo.lock`, byte-identical across two runs): Part 1: pages 1–58, 52,229,815 bytes / 49.81 MiB; Part 2: pages 59–60, 1,801,351 bytes / 1.72 MiB. Same page ranges and limits, different byte sizes from the Windows record; cause not established. Packaged-app splitting remains UNVERIFIED; each child part strictly adheres to both limits (≤ 50 MiB and ≤ 1,000 pages); complete, non-overlapping page coverage (1–58 and 59–60 cover all 60 pages); historical Windows manual range (pages 10–20) extracts exactly 11 pages (9,819,106 bytes / 9.36 MiB); the Mac manual output has the same 11 ordered pages and is 9,905,927 bytes / 9.45 MiB; ordered page IDs `P0001`..`P0060` verified in source tests; measured peak resident memory (RSS), wall-clock duration, and UI responsiveness recorded under stated 54 MB input size; original source file SHA-256 untouched. | `MAC-09` (Safe splitting), `MAC-11` (Concurrent writes), `PERF-MAC-03` |

### 5. `.hfdbackup` complete round-trip checklist

The portable backup format is a ZIP archive created via `ZipWriter` and read via `ZipArchive` (`src-tauri/src/backup.rs`), referencing `docs/backup-format.md`. It is not a gzip tar archive.

| Step | Action | macOS Verification / Pass Criteria | Where evidence belongs |
| --- | --- | --- | --- |
| 1. Baseline Population | Import Fixture A, split Fixture B, create 1 Daily Flight Plan, save 1 quick debrief with an accepted action linked to Fixture A and an edited question carried to a lesson. | Profile contains active database records, linked metadata, and managed document files in `~/Library/Application Support/com.herflightdeck.app/documents/`. | `MAC-04`, `MAC-12`, `MAC-13` |
| 2. Complete Backup Export | In Settings -> Data management, click "Save complete backup". In the save dialog, select the exact destination path (e.g. save to `~/Downloads/her-flight-deck-backup-....hfdbackup`). | File is written with `.hfdbackup` extension at the chosen destination path. Progress indicator displays bounded archive creation; app remains responsive. | `MAC-07` |
| 3. ZIP Structural Inspection | In Terminal, set or quote the **exact `.hfdbackup` path selected in the save dialog** (e.g. `BACKUP_PATH="$HOME/Downloads/her-flight-deck-backup-...hfdbackup"`). Run `unzip -t "$BACKUP_PATH"` and `unzip -l "$BACKUP_PATH"` against that one file. Do not use wildcard `~/Downloads/*.hfdbackup`. | `unzip -t` reports `No errors detected in compressed data`. `unzip -l` must confirm the required file entries: `manifest.json`, `integrity.json`, `her-flight-deck.db`, and managed document paths (`documents/<path>`), and allows directory entries (such as `documents/`) if present in the archive. This is a structural archive check only; full data integrity validation is performed by the app. | `MAC-07` |
| 4. Credential Exclusion Verification | Verify that secret files are excluded from the backup archive without displaying or copying credentials. | In Terminal, run a fail-closed, non-disclosing check of archive entry names for `gemini-key` and `gemini-key.writing` with only pass/fail/error output:<br>`(TMP_LIST="$(mktemp "${TMPDIR:-/tmp}/hfd-zip.XXXXXX" 2>/dev/null)" \|\| { echo "INSPECTION ERROR: archive missing, unreadable, or corrupted" >&2; exit 2; }; trap 'rm -f "$TMP_LIST"' EXIT INT TERM; if ! unzip -q -l "$BACKUP_PATH" > "$TMP_LIST" 2>/dev/null; then echo "INSPECTION ERROR: archive missing, unreadable, or corrupted" >&2; exit 2; fi; grep -q -E '(^\|[ /])gemini-key(\.writing)?([ /]\|$)' "$TMP_LIST"; GREP_STATUS=$?; if [ "$GREP_STATUS" -eq 0 ]; then echo "FAIL: credential entry found in archive" >&2; exit 1; elif [ "$GREP_STATUS" -ne 1 ]; then echo "INSPECTION ERROR: archive missing, unreadable, or corrupted" >&2; exit 2; fi; echo "PASS: no credential entry names in archive"; exit 0)`<br>Alternatively, run the reusable cross-platform tool: `node scripts/inspect-backup-credentials.mjs "$BACKUP_PATH"`.<br>Note: Archive-entry-name inspection alone cannot prove arbitrary database content contains no secret; rely on the fixed backup allowlist (`allowed_archive_path` in `src-tauri/src/backup.rs`, which strictly permits only manifest, integrity data, database/WAL, and `documents/*`) and focused Rust regression coverage (`an_archive_may_only_contain_her_database_and_documents`, `secrets.rs` storage isolation, and `complete_backup_keeps_the_pdf_plan_progress_provenance_and_ledger_and_retries_safely_after_restore`) for that boundary. Do not display, print, copy, or log an actual key or database content. | `MAC-07`, `MAC-16` |
| 5. App Restore Validation | In a clean secondary test profile, go to Settings -> Data management, click "Restore backup", and select the exact `.hfdbackup` file. | App inspects archive; pre-restore preview modal displays restorable payload file count (`her-flight-deck.db` plus managed documents) and their uncompressed byte sum, as defined by `src-tauri/src/backup.rs` (excluding internal archive metadata `manifest.json`, `integrity.json`, and directory paths). Do not expect this preview count or uncompressed byte total to match the ZIP's raw entry count from `unzip -l` or the archive's compressed file size on disk. Confirming restore extracts files, verifies each file against `integrity.json` SHA-256 hashes while writing, updates the database, and restarts cleanly. | `MAC-08`, `PERF-MAC-04` |
| 6. Post-Restore Verification | Inspect restored application state. | All Daily Plan items, debrief actions, questions, and Study Library materials are intact. SHA-256 hashes of managed documents in `~/Library/Application Support/com.herflightdeck.app/documents/` match pre-backup hashes. Retrying operations causes no duplicated records. | `MAC-08`, `PERF-MAC-04` |
| 7. Corrupted Archive Rollback | Attempt restore with an intentionally truncated `.hfdbackup` file. | App detects corrupted archive during staging; aborts restore cleanly; displays clear error message; rolls back to existing profile state with zero data corruption. | `MAC-08` |
| 8. Failed Restore Rollback & Retention (A1) | Simulate an obstructed restore destination, linked pending/staging root, cleared document protection failure, or inject an install failure during activation using an isolated test profile/harness. | App executes rollback safely; original database/WAL/documents remain recoverable under `backups/<timestamp>-before-restore/` until verified recovery; errors are truthful; unknown destinations, external files, and original artifacts are never deleted, moved, or pruned; linked pending/staging roots are rejected before access (`inspect_storage_root`); document protection failures reconcile unmoved active documents without permanent lockup; known-empty original manifests strictly enforce 0 active files. | `MAC-08` |
| 9. Startup Safety Gate on Unresolved Recovery (A1) | Relaunch the application while an uncommitted restore, modern journal lacking plan ownership, or `.recovery-pending` marker remains in application storage. | Tauri setup consumes `StartupRestoreDecision::BlockedUnresolved` and immediately halts startup with an actionable error. The application never creates a fresh SQLite database or executes migrations over stranded original data; terminal cleanup refuses deletion when plan ownership is missing for modern operations. Once the obstruction is cleared and recovery finishes, normal startup proceeds cleanly. Note: Physical Apple Silicon Mac, early macOS 12, installed Windows, and live Gemini remain UNVERIFIED. The frozen v0.5.3 DMG cannot certify newly changed source. | `MAC-08` |


## M2 Study Library preparatory review and packaged Mac measurements

### Preparatory review: contract tests and fixture gaps (planning only)

Per `ROADMAP.md` and `docs/M2_STUDY_LIBRARY_DESIGN_2026-09-27.md`, **migration 11 and M2 product UI must not be added before the required 1–2 week check-in with the real user**. The following preparatory contract tests and fixture gaps represent the only allowable pre-implementation work:

1. **Legacy conversion contract fixtures:**
   - Create deterministic test fixtures representing legacy `ai_study_sets` (migration 7) and `practice_tests` (migration 9) records with unkeyed JSON arrays.
   - Specify and test deterministic migration/upgrade rules for edge cases: empty question arrays, missing explanation fields, out-of-bounds choice indices, and malformed JSON rows. Ensure malformed rows fail visibly rather than silently erasing user study content.
2. **Review scheduler pure contract tests:**
   - Define a pure, versioned scheduling function taking `(priorState, rating: Again|Hard|Good|Easy, schedulerVersion, now)` and returning `nextState`.
   - Implement unit contract tests covering: initial exposure, consecutive successful reviews, lapse/failure reset, minimum/maximum interval clamping, local midnight transitions, time-zone offsets, and system clock rollback.
3. **Multi-table transaction and idempotency contracts:**
   - Define repository contract tests asserting atomic writes across content versions, study items, practice attempts, and review events using pinned desktop transactions.
   - Verify that rapid duplicate submissions (e.g. double-clicking answer buttons) and network retries do not duplicate attempt or review event records.
4. **Split lineage metadata contracts:**
   - Specify and test schema contracts linking child document parts to parent materials (parent ID, first page, last page, source version hash) without altering the existing 50 MiB / 1,000-page stored PDF byte contract.
5. **Bounded query contracts:**
   - Specify cursor-based or paged query contracts for study history, review queues, and attempt records to avoid loading large event collections into `AppDataContext`.

### Packaged Mac app measurements needed (no premature code-inspection optimizations)

Do not optimize Study Library search, PDF splitting, or global refresh based solely on code inspection or Windows/jsdom metrics. Specific runtime measurements must be gathered directly on the packaged Apple Silicon Mac application (`Her Flight Deck.app`):

1. **WKWebView search, filter, and sort latency:**
   - Populate the packaged app with synthetic library tiers (100, 500, and 2,500 materials).
   - Measure keypress-to-paint latency and interaction-to-next-paint (INP) during text search filtering and column sorting inside macOS WebKit (WKWebView).
   - Record frame rate drops and DOM node count scaling during fast list scrolling.
2. **Apple Silicon PDF splitting throughput and memory profile:**
   - Execute automatic and manual splitting on Fixture B (1,050 pages) and Fixture C (60 pages with raster images) in the packaged release binary.
   - Measure wall-clock duration and background thread CPU usage on Apple Silicon native ARM64 cores; record responsiveness and throughput without assuming a Mac-specific speedup.
   - Measure actual peak resident memory (RSS) using macOS Activity Monitor or `vmmap` at stated input sizes. Do not claim that windowing guarantees a source-independent or strictly bounded total memory footprint: `lopdf` loads the entire source document into memory and candidate extraction clones object graphs. Record the empirical peak memory and verify the application remains responsive without paging thrash or OOM crashes.
3. **Global refresh and state mount costs:**
   - Measure `AppDataContext` reload latency and component mount duration when adding, splitting, or deleting materials.
   - Measure whether material updates trigger unnecessary re-renders in unrelated tabs (e.g., Daily Plan or Debrief Journal).
4. **Native macOS system integration response times:**
   - Time the system default PDF viewer launch (`open_pdf` using Preview via `opener`) from click to visible window.
   - Time Finder reveal (`reveal_file`) from click to Finder window activation and file highlight.

## Mac execution sequence

- [ ] Obtain an Apple Silicon Mac and a separate OS test account or spare machine with synthetic data. Preserve real user data. Do not assume an environment-variable override isolates Tauri's data directory.
- [ ] Select the reviewed exact commit/candidate and record its version. Do not distribute a retired 0.5.2 build. Keep existing published releases/tags untouched.
- [ ] Install development prerequisites only on the build machine; document the actual toolchain. End users should follow packaged installation instructions, not development setup.
- [ ] Source and local build validation: From the repository root run `npm ci`, `npm test`, `npm run build`. From `src-tauri` run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`. A candidate DMG rebuilt locally with `npm run tauri build -- --bundles dmg` is useful for source and packaging script validation, but cannot substitute for the draft asset under the exact-installer rule.
- [ ] Candidate draft verification: Download the exact private v0.5.3 draft DMG (`Her.Flight.Deck_0.5.3_aarch64.dmg`) from GitHub Release draft workflow run `36515016063`. Verify its SHA-256 hash matches `de81be50122275104ca9e6791162a7bac6cd43a672c5580d5fbc509b5d16efec` before mounting.
- [ ] Install and smoke-test only the exact private v0.5.3 draft DMG: Mount the verified draft DMG, drag `Her Flight Deck.app` to `/Applications`, and execute the Gatekeeper check, Priority 0 blockers, Priority 1 items, and performance checks exclusively on this installed draft artifact. Record command output and UI results separately. Do not install or test a locally rebuilt DMG for parity verification.
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
Git commit SHA / clean-or-dirty tree:
Workflow run URL / Run ID:
Exact draft DMG filename / 64-char SHA-256 (matches SHA256SUMS.txt):
Mac model / Apple Silicon chip / Unified RAM / macOS version:
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

Mac parity requires evidence for the shipped feature set on the exact candidate, not merely code shared with Windows. Under the **Exact-Installer Invariant**, physical installation, smoke testing, and parity checks must be performed exclusively on the exact private v0.5.3 draft DMG (`Her.Flight.Deck_0.5.3_aarch64.dmg`, SHA-256 `de81be50122275104ca9e6791162a7bac6cd43a672c5580d5fbc509b5d16efec`) matching `SHA256SUMS.txt` from GitHub Release draft workflow run `36515016063`. A DMG rebuilt locally from today's `main` is useful for source and packaging pipeline validation but cannot substitute for the draft asset under the exact-installer rule; testing a newly built artifact does not authorize releasing draft bytes, and testing a preliminary artifact does not authorize releasing newly built bytes.

As documented in [FULL_REPOSITORY_AUDIT_2026-09-29.md](FULL_REPOSITORY_AUDIT_2026-09-29.md), **v0.5.3 is a recorded frozen private candidate with known source defects** (including failed-restore rollback deleting its database, non-atomic material/tag saves on duplicate tags, lack of early macOS 12 `structuredClone` compatibility, offline-study visibility issues, and unverified native dialogs). **v0.5.3 is not currently approvable merely by passing the Mac checklist.** Its recorded identity, packaging artifacts, and draft checksums are preserved for evaluation and audit integrity. Future release acceptance must use the exact newly reviewed candidate designated after product repairs and an explicit version decision. Do not retire or bump versions, modify published tags or releases, replace draft assets, or override the Windows hold before that formal decision.

A Mac release proceeds under its own independent Apple Silicon installed-device verification gate, while Windows distribution remains held on `v0.5.1` pending separate Microsoft Defender clearance. Close Priority 0 blockers; address Priority 1 failures or explicitly defer nonblocking work with reasons; record performance evidence and remaining limits. Verify backup/restore, migration, permissions and credentials before distribution. Under the no-retag rule, failed candidates are permanently retired in policy and never retagged. iOS is a separate target and is not certified by Mac testing.
