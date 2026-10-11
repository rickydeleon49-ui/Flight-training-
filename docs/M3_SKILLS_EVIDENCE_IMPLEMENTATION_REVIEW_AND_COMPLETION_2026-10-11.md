# M3 skills evidence — review and interrupted implementation completion

11 October 2026. Reviewer/completer: Codex, at the owner's explicit request after the implementation model exhausted its usage.

## Result

The authorized first M3 production slice is implemented: migration 14, native atomic writer and bounded readers, matching TypeScript/browser storage, restore validation, skills catalog and detail page, debrief observations, retained revision history, explicit follow-up links, independent status/confidence and permanent regression coverage. No dependency was added. The source is technically accepted with the completed corrections and all nine local gates passing. GitHub integration requires passing checks for the exact published head. Installed G1–G3 remain **DEFERRED / UNEXECUTED / UNVERIFIED**. This is source acceptance, not a signed release or installed-Mac result.

## Starting point and preserved work

The interrupted checkout was `/Users/rickymac/code/Flight-training-m3-implementation`, branch `codex/m3-skills-evidence-implementation`, base `196b63f230dbe7a3aad69641272ab5303571cb76`. Source was uncommitted. Its accepted migration, native/TS implementation, browser-driver test and 29-reversion runner existed. The runner had finished with **27/29 variants caught**; TS-13 and NA-14 were not caught. No completion report, tracking entry, final source manifest or evidence checksum manifest existed.

Before edits, all tracked/nonignored working files were hashed to a temporary checkpoint. The submitted source subset is preserved in `takeover-start-hashes.json`; `takeover-changes.json` names all 14 paths changed during takeover. The application source remained unchanged while the checkout fast-forwarded to `b64ac842e6597a8e2b8970def35285418d20820d`, importing only published M4 review documents and tracking history. The dirty primary, accepted M3 preparation and Gemini M4 checkouts were not edited.

The review examined migration registration/ceiling/checksum, transaction/replay/erasure, native command/read ownership, TS/native read/result parity, semantic restore checks, controller/form lifecycles and real-screen integration. The owner authorized finishing fixes as well as reviewing; the fixes below are reviewer-authored and identified explicitly rather than presented as independently implemented corrections.

## Confirmed issues and completed corrections

| ID | Trigger and impact | Correction and permanent proof |
| --- | --- | --- |
| M3P-R1 | The custom-skill writer's answer is lost after commit; changing the label makes the hook discard that exact request and mint a second skill. | Retain and resolve the old request before sending changed intent. Return `earlier_done`, keep the dialog/current fields, and distinguish earlier content from unsent changes. `catalog-recovery.test.ts`: **catalog changed draft first resolves its unknown create and does not mint a second skill**. The add-skill message states that a later deliberate save creates another skill; existing-skill rename advances only its acknowledged revision. |
| M3P-R2 | Two catalog submits before another render call the writer twice; an answer after unmount also starts another load. | Synchronous per-key flight ownership; identical submissions join. Lifecycle ownership guards refresh; records are deleted only by their owner. **catalog same-turn double submission joins one request** and **a catalog acknowledgment after unmount performs no refresh**. |
| M3P-R3 | Changing an item edit after an unknown answer discards its replay identity, sends an obsolete revision and cannot accurately identify what saved. | Resolve/replay the earlier action exactly; changed intent receives `earlier_done`, not success for the new wording. The edit/link dialogs retain fields and advance to the owned acknowledged revision. Fields are disabled during a pending item/catalog write. **changed item wording resolves the earlier unknown request without claiming the new wording was saved**; real-screen **editing after a lost acknowledgment retains the new wording and saves at the acknowledged revision** proves revision 2 contains Earlier, then revision 3 contains Changed. |
| M3P-R4 | Changing the skill/source after save offers replacement, although the stored observation's skill/debrief/source are immutable. The controller can acknowledge an edit that never stored those identity changes. | Saved draft content includes provenance. Replacement rejects changed skill, debrief or source field without writing; the form names unsaved skill/source and directs Save as new. **changing skill or debrief provenance cannot be acknowledged as an edit of the saved observation** and **a skill change during save is named as unsaved and must be saved as a new observation**. |
| M3P-R5 | Navigate to another skill while an edit dialog is open: the old dialog remains and can operate on the previous observation from the new page. | Key the evidence view by skill and debrief card by entry; mask the old scope until the load effect establishes the new one. **a route change disposes the previous skill's edit dialog without writing its draft**. |
| M3P-R6 | The history-cursor reversion tests use revision 50 on a target with only one revision. Removing observation binding still fails another range check, so the named test passes and misses the removed safeguard. | Give the target two revisions and use a foreign cursor at revision 2, valid for either history except its observation identity. The same TS and native tests now fail specifically when binding is removed. All 29 final variants are caught and restored, with 14 controls passing. Production history-cursor checks were correct and remain intact. |

Four recovery tests failed before their fixes, two provenance tests failed before theirs, and the real-screen route case failed before its fix. Raw failures are retained under `completion/`; the first full run also includes that pre-fix route failure. No expectation, timeout, teardown or production validation was weakened. Eight new permanent cases supplement the preserved suites. The browser-driver file left by the implementer is complete and passes against the real sql.js driver, including storage refusal restoring bytes/tables, exact retry/replay and reopen validation.

## Verification

The authoritative gate is `final-gate/summary.json` with the complete command/cwd/output/exit receipts. Toolchain uses Node 22.23.3 (the CI lane) and scoped Homebrew Rust with Xcode's macOS 27.0 SDK; no installer was built. A standalone `typecheck` is followed by focused tests, full frontend tests, build, Rust tests, Clippy with **--all-targets -D warnings**, fmt, lock synchronization and whitespace checks, sequentially.

| Final check | Verified result |
| --- | --- |
| Typecheck | exit 0 |
| Focused storage/controller/screens | 118 passed, exit 0 |
| Full frontend | 3,024 passed / 6 skipped, exit 0, no reported unhandled errors |
| Frontend build | exit 0 |
| Full Rust | 465 passed / 6 ignored, exit 0 |
| Clippy, all targets, warnings denied | exit 0 |
| Rust format | exit 0 |
| Cargo lock synchronization | exit 0 |
| Whitespace hygiene | exit 0 |

- Migration 0014 is byte-identical to the accepted candidate, SHA-256 `34acb4c4cd22826512c1cd3d331675be6d2b223abe2322af8977769bcb3c048a`; all shipped 0001–0013 SQL bytes and all dependency/lock files equal current main. `invariants.json` records these checks and the matching accepted shared fixture bytes.
- Shared native/node:sqlite/sql.js proofs cover 85 semantic fixtures, 29 constraint fixtures, operation outcomes and exact read JSON. Upgrade tests use a populated genuine schema-13 library, preserve retained rows, refuse incompatible newer state and roll back failed upgrades. Native backup tests create/restore real disposable archives and refuse tampered database/receipt content before moving live data.
- `sensitivity/` is the untouched original run, including the two uncaught variants. `sensitivity-final/` records the strengthened cursor cases; `sensitivity-current/` repeats all guards against the complete final source and preserves full raw stdout/stderr for every control and variant. The current result has 14 passing controls and **29/29 removed safeguards caught**, all scratch files restored. Each receipt names its test and source snippet; an infrastructure/compile failure alone does not count as caught.
- Production source benchmark: both node:sqlite and sql.js at 100 / 2,500 / 5,000 / 10,000 observations, 215 skills and 400 debriefs; bounded history walks reach revision 1. At 10,000 observations, first-page p95 was 0.185 ms / 0.553 ms and semantic validation 288.0 ms / 431.6 ms respectively. The 1,000-revision walks reached all revisions in 10 pages per engine. Timings exclude installed WKWebView and browser localStorage export; they are not a desktop responsiveness claim.

## Publication and next step

The published implementation includes this report, complete evidence, source hashes and checksum manifest. Merge only after exact-head required GitHub checks pass and current-main integration is confirmed. Historical tracking entries remain preserved; ROADMAP section 8 records this delivered slice without claiming M4 or installed verification complete.

The next reviewer handoff is [M3_COMPLETION_NEXT_REVIEWER_PROMPT_2026-10-11.md](M3_COMPLETION_NEXT_REVIEWER_PROMPT_2026-10-11.md). M4 remains the separately assigned, proposed preparation task; no production M4 migration, dependencies or owner defaults were activated here. Do not run an app in an everyday profile, rebuild the frozen installer, sign, publish a release or call a provider as part of this handoff.
