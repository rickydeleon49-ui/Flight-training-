# v0.5.4 desktop corrections — independent acceptance, 15 October 2026

**ACCEPTED for source integration through the containing PR's exact-head CI. No blocking code defects found.** DESKTOP-V054-01, -03 and -04 meet their scoped source criteria. DESKTOP-V054-02 is investigated/not reproduced; its original no-window observation is not assigned a proven root cause. This acceptance is not final candidate or public-release acceptance.

## Identity and scope

Reviewed Claude's uncommitted `codex/v054-desktop-corrections`, base `7f2a62421cc48679e59e7769c1ee9ca11e02c8e4`. All47 submitted source/document/evidence hashes and35 receipt checksums matched before review and again after independent tests. Integration starts from main `3367ac3f557c2b78c21cd7180ac8a8892718301e`, preserving the separately merged research and owner-approved post-v0.5.4 queue (#172/#173). Application source/test bytes are copied exactly from the reviewed package; only tracker integration, acceptance/handoff evidence and narrowly scoped raw-receipt whitespace handling are additional work.

Claude's original dirty checkout/package remains untouched. Its original tracker versions are frozen under the review evidence's `submitted/` paths; the original submission manifest is historical and its three tracker entries refer to those frozen copies after integration. Every other submitted file remains byte-identical. The new integration inventory covers current files. The current helper20-path inventory is refreshed for tracker bytes; historical proof receipts, baseline and allowlist remain unchanged.

## Findings and acceptance reasoning

- **01, material dates:** both actual Added/Last reviewed labels convert stored timestamps through the existing strict localDayOf helper, preserving bare calendar days and explicit unreadable fallbacks. Stored dates and clocks are unchanged. Real-SQLite rendered regressions cover the original evening defect and clicking Mark reviewed today; helper cases include offsets, DST boundaries, positive-offset Kiritimati, invalid input and years.
- **04, backup dates:** Settings and DataRecovery use one parser for the genuine Rust UTC backup-name timestamp. The native generator confirms that name format; folder modification time is not treated as backup creation time. Native screenshot confirms the Settings list/confirmation uses ThursdayOct15 for the relevant UTCOct16 backup. Rendered DataRecovery regressions cover the same day and unknown fallback. No backup name, storage format or restore selection changes.
- **03, restored-window activation:** startup restore handling retains the same ordering before SQLite opens. Only RestoreCompleted returns true and requests show/set_focus for main; normal, refused and rolled-back starts do not activate; unresolved state still returns the same startup-blocking error. Focus errors log and do not undo a committed restore. Both new decision tests and the unchanged restore suite pass independently.
- **02, investigation:** submitted window-server observations independently show visible windows after two e928601 self-restarts, with the other app left frontmost. This supports the non-activation finding, not a retrospective explanation of the original CUA noWindowsAvailable outputs. Those original observations remain preserved and unexplained.

No new correction assignment is necessary. One minor evidence limitation is retained: the monitor emits whole-second timestamps with a literal `.3N` fragment, and the watcher's `oldpid` value in the counted run is already the new PID. The full monitor sequence still independently records45905→47312 and window4543→4555; the watcher records Claude frontmost, then47312 frontmost three seconds later. Treat timing as approximate and the `oldpid` label as unreliable, not as a unique old-process identity. The one counted native focus run supports the bounded behavior; it does not establish Stage Manager/multiple-Space/display coverage.

## Independent verification

All nine sequential checks exit0: focused44/44; typecheck; full frontend **3,242 passed /6 skipped**, no reported unhandled errors; frontend build; Rust **467 passed /6 ignored**; fmt; Clippy all targets with warnings denied; Cargo-lock synchronization; diff hygiene. The focused check is additional to the full matrix; the table-free list above groups exactly the9 entries in review-gate.json (focused, typecheck, frontend, build, rust, fmt, clippy, cargo-lock, hygiene). Node22.23.3 and scoped rustup/SDK26.5 were used. No parallel full matrices.

The private UNCOMMITTED test executable independently hashes to `721460a2a9ba775f3de640e9411c3a805e245ebed1fb72fd2e46620e992763ba`; strict ad-hoc verification exits0. It was not launched or rebuilt by this review. Native screenshots/watch/window-server receipts were inspected, not represented as reviewer-executed installed tests. Dependencies, versions, bundle ID and migrations remain unchanged.

Evidence: [independent logs and identity](evidence/mac-v054-desktop-corrections-review-2026-10-15/README.md). The original failed typecheck/build receipts and failed-before rendered tests are preserved. No test profile, archive, credential or native binary is published.

## Release continuation

Next: [one fresh candidate from the containing PR's accepted merged main, followed by exact-candidate verification](MAC_V054_FINAL_CANDIDATE_PROMPT_2026-10-15.md). Do not relabel the e928601 candidate or the UNCOMMITTED test app as that new candidate. Original installer artifacts remain frozen.

Standard-account/hfdtest, schema12 exact-candidate restore, deliberate tombstone UI, minimum macOS, VoiceOver and signing/publication retain their recorded unverified/deferred status until actually checked or separately dispositioned. This source acceptance does not make them green. The already-selected local ad-hoc route does not require another signing/version decision. All eight selected improvements start **after** the next release, in #173's order.
