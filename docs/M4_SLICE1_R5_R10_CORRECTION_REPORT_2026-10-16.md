# M4 Slice 1 R5–R10 correction report — 16 October 2026

**Status: submitted for Codex review on PR #189; not accepted, not merged.** This round corrects the six findings of [the independent re-review](M4_SLICE1_REREVIEW_2026-10-16.md) under [the R5–R10 assignment](M4_SLICE1_R5_R10_CORRECTIONS_PROMPT_2026-10-16.md). The feature, the R1–R4 fixes and all earlier receipts are kept. Owner approval OD-1–OD-10 (including OD-6 refuse-and-explain) is unchanged.

No app launch, profile, provider call, installer build, signing, version change, new dependency, schema change or release took place. Installed desktop behaviour is **UNVERIFIED**: every test here is a source-level test.

## Identity

- **Reviewed head 6d8c608:** 66 of 66 frozen hashes in `submitted-snapshot.json` matched before any edit, and the tree was clean.
- **91ec3fc:** merge of origin/main d97e1a9 (#190).
  - Both tracker histories are kept; the review entry sits above the submission entry.
  - PR #187's folder-opening correction is untouched.
  - The schema-14 completion manifest is rebound to the merged trackers and to the feature's own helper-test sources, not main's older hashes.
- **Commits in this round:**

  | Commit | Content |
  | --- | --- |
  | e756353 | R10 |
  | 86a438a | R5–R8 |
  | c14afff | R9 |
  | 7979e14, fad8d3a | checkpoints |
  | the documentation commit | this report, trackers and manifests |

- **Source hashes:** every source and test file changed in this round is listed in [source-hashes.txt](evidence/m4-slice1-r5-r10-corrections-2026-10-16/source-hashes.txt).
- **Contract:** no new schema, migration, dependency or native command. Migrations 1–14 and their checksum records are unchanged. The only contract addition is a TypeScript controller method, `openSaved`, and its `SavedDestination` type.

## Reproduction before any fix

Run on source identical to 6d8c608 (the merge changed only docs). Raw receipts are in [failed/](evidence/m4-slice1-r5-r10-corrections-2026-10-16/failed/):

| Diagnostic | Result | Exit |
| --- | --- | --- |
| Frozen TypeScript diagnostics, placed as the review README says | 9 existing controls passed, 4 new failed (R5, R6, R7, R8) | 1 |
| Frozen native patch (`reviewer_r10`) | `committed=true` assertion failed | 101 |

Each diagnostic is now a permanent regression under its own name; the copied controls were not duplicated. The reviewer copies were deleted once promoted. The new permanent tests were also run against the reviewed sources:
- [hook-regressions-on-reviewed-source.log](evidence/m4-slice1-r5-r10-corrections-2026-10-16/failed/hook-regressions-on-reviewed-source.log): 13 failed, plus 2 deliberate controls that passed.
- [ui-regressions-on-reviewed-source.log](evidence/m4-slice1-r5-r10-corrections-2026-10-16/failed/ui-regressions-on-reviewed-source.log): the R5, R6 and badge-unmount cases failed. Two more failed only because the new message constants are absent there, as the log's header says.

## Issue-to-test map

| Finding | Correction | Permanent tests |
| --- | --- | --- |
| **R5 [P1]: saved bookmarks re-aimed at replacement content** | A bookmark opens through `NavigationController.openSaved(SavedDestination)`. It carries the material, the originating content hash, the page and the label; a fresh "Open at page" stays `request`. After inspection, a different hash or an unknown (null) origin is refused with an explanation: nothing is opened, reserved or saved. The inspection has already recorded the new identity and drifted the old places, and the panel reloads to show that. The native verified open and commit still compare the saved hash, so the native boundary would refuse too. | Controller (`controller.test.ts`, "opening a saved place…"): matching content; same-count replacement; other labels and fewer pages (refused as changed, not clamped); held inspection; replacement after inspection, refused by the verified open, with the claim cancelled; deleted file; null origin; a fresh request still resolving against the current file. UI (`DocumentPagesPanel.test.ts`): the promoted diagnostic, checking the opener is never called, the tuple is unchanged apart from its drift, and no Open button remains; an unchanged file opening its own page and label; held inspection; deleted file. |
| **R6 [P1]: an open bookmark draft rebound after a refresh** | "Add bookmark" captures a `BookmarkDraft` (material, hash, page count, suggested page) when the dialog opens. The dialog and its save use only that draft. If the panel's identity later differs, the dialog shows a stale notice. Saving sends the draft's own hash and is refused as STALE_STATE by the transaction, with her typing kept. A material change drops the draft. The native R1 compare-and-set is unchanged. | `DocumentPagesPanel.test.ts`: the promoted diagnostic, with the parent really re-rendered to B through the shared controller and the page count unchanged (stale notice, STALE_STATE, no row, typing kept); a replacement while the save is held; an unchanged file saving normally; a draft not following the panel to another material. The earlier database-only held-bookmark test is kept. |
| **R7 [P2]: stale reloads overwrote newer state** | `useMaterialNavigation` numbers every read. State, error and the end of loading are applied only while that read is still the latest and the hook is mounted. A change of material or repository clears the old state and retires reads in flight. Cleanup retires reads; StrictMode's replayed setup mounts again. | `useDocumentNavigation.test.ts`: the promoted diagnostic (held success); a held stale error; a stale completion not ending the latest loading; material change; repository change; follow-up reads after a mutation and after a settled controller status; the page-check follow-up; unmount; a real StrictMode root (setup, cleanup, setup), checking the hook still publishes afterwards. |
| **R8 [P2]: retired guidance still opened an old document** | The bundled inspect-and-open port is gone. `openForGuidance` inspects through the port, checks the epoch, and only then dispatches the verified open with the inspected hash. Nothing unserializable crosses Tauri. Source badges abort a request they started that is still working when they unmount (route change). Guidance still reserves no token, saves no position and confirms no reading. An open already handed to the OS is not claimed to be undoable. | `useDocumentNavigation.test.ts`, through the real `navigationControllerFor` composition: the promoted diagnostic; legitimate guidance (opens the inspected content, no writes); abort and dispose during a held inspection; a newer failed request; a newer refused page request. `DocumentPagesPanel.test.ts`: leaving the view while a badge's file is being checked opens nothing. `controller.test.ts`: the guidance case now records inspect then open. |
| **R9 [P2]: the exact-head CI failure** | Cause: "Add an observation" is disabled until the skill list loads, and `findByRole` also finds disabled buttons. In CI's failed run the test clicked while the list was still loading, so no dialog opened; the failure DOM shows the button enabled later and the dialog closed. A held `listSkills` reproduces this deterministically ([r9-diagnostic.log](evidence/m4-slice1-r5-r10-corrections-2026-10-16/r9-diagnostic.log), [source](evidence/m4-slice1-r5-r10-corrections-2026-10-16/r9-diagnostic.test.ts.txt)). The race is in test code identical to accepted main; it is not a navigation defect. Fix: both evidence-card tests wait until the button is enabled. No retry, timeout increase or suppression; the double-click assertion (exactly one observation) is unchanged. | `skillScreens.test.ts` (`addObservationWhenReady`). The first red run stays preserved as `docs/evidence/m4-slice1-r5-r10-review-2026-10-16/ci-failed.log` (run 38985040191). |
| **R10 [P1]: an inflated cached count authorized a nonexistent page** | `check_current_file` derives both hash and page count from the managed file's bytes on every checked commit, confirmation and bookmark. Equal hash with a different count is repaired: the identity is recorded and saved places reconciled in the same immediate transaction, and the request is refused (commit `identity_changed`, others FILE_CHANGED) so it is made again against the real count. Bytes that are not a PDF are refused as NOT_A_PDF with nothing written. The verified open also refuses a recorded count the bytes don't have, and writes nothing. It reuses the existing lopdf parsing. | `navigation_tests.rs`: `an_inflated_cached_count_cannot_authorize_a_nonexistent_pdf_page` (the promoted diagnostic: 50-page PDF, cache 500, page 450 refused, count repaired, retry `out_of_bounds`, page 50 saves); `a_deflated_cached_count_is_repaired_and_the_request_made_again_succeeds`; `a_correct_cached_identity_is_left_alone`; `bytes_that_are_not_a_pdf_behind_a_matching_cache_are_refused_and_nothing_is_written`; `bookmarks_and_read_confirmation_are_bounded_by_the_real_count`; `opening_refuses_a_recorded_count_the_bytes_do_not_have`. Replacement, deletion, relink, held-action and retry regressions all still pass. |

## Policy for inconsistent cached identity (R10)

- **A recorded row that disagrees with the bytes is metadata, not truth.** The bytes win: hash and page count are re-derived, the row is rewritten, and bookmarks and reading state are reconciled against it in the same transaction. An in-range place on the same content is verified or active; anything else is drifted, and an unknown origin is unverified.
- **The request that met the mismatch is refused**, never clamped or re-aimed. The person sees why and can ask again; the retry is judged against the repaired count.
- **Bytes that are not a PDF cannot be repaired.** Whatever the row says, the request is refused and nothing is written. A later inspection reports NOT_A_PDF until the file is restored.
- **Restored backups and corrupt rows follow the same rule.** The navigation verifier accepts a well-formed row; the first content-sensitive native operation corrects it.

## Exact guarantees

- **Native checked writes:** inside the write's own immediate transaction, the file at the material's current managed path has exactly the recorded hash and page count, and the request is the exact current, non-cancelled token (commit) or names that exact content and generation (confirmation and bookmark).
- **Native verified open:** at hand-over, that file's bytes match the expected hash, the recorded hash and the recorded page count. What the external reader reads afterwards is outside the app's control, and it may not jump to the page; the page is guidance.
- **ABA:** checks compare endpoints. A replacement restored to identical bytes between two checks (unobserved A→B→A) is not detected, and nothing wrong is saved because the content is again the one the request named. A replacement that a check did observe is recorded, and restoring A afterwards is itself a change (see the corrected paragraph in the completion report).
- **Controller:** no external side effect (reservation, open or commit) is dispatched for a retired request. A commit that landed before a newer request is a genuine earlier save and is not published. Native cancel and commit are serialized on the claim row.
- **Browser mode** has no managed files. Its tests prove database semantics (compare-and-set, shapes, reconciliation in the test stand-ins), not native PDF inspection.

## Gate

Final sequential gate on Node 22, recorded in [final/environment.txt](evidence/m4-slice1-r5-r10-corrections-2026-10-16/final/environment.txt) and [final/sdk26.5-environment.txt](evidence/m4-slice1-r5-r10-corrections-2026-10-16/final/sdk26.5-environment.txt). Receipts are in [final/](evidence/m4-slice1-r5-r10-corrections-2026-10-16/final/):

| Step | Command | Result | Exit |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | clean | 0 |
| 2 | `npm test` | 154 files passed, 4 skipped; 3,455 tests passed, 6 skipped | 0 |
| 3 | `npm run build` | built | 0 |
| 4 | `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 518 passed, 6 ignored | 0 |
| 5 | `cargo clippy --locked … --all-targets -- -D warnings` | clean | 0 |
| 6 | `cargo fmt … --check` | clean | 0 |
| 7 | `npm run test:cargo-lock` | in sync | 0 |
| 8 | `node --test scripts/mac-schema14-profile-snapshot.test.mjs` | 26 of 26 | 0 |
| 9 | `git diff --check origin/main...HEAD` | clean | 0 |
| 4b–6b | steps 4–6 again with `SDKROOT` scoped to the Command Line Tools MacOSX26.5 SDK | 518 passed, 6 ignored; clean; clean | 0 |

Steps 1–9 ran at fad8d3a, the final source, on Node 22.23.3 with the default SDK (27.0); 4b–6b used the established 26.5 SDK on the same source. Later commits change only documentation, evidence and the helper manifest bindings, and `git diff --check origin/main...HEAD` is run again on the final commit.

Exact-head CI on PR #189 decides the final commit.

## Evidence

[evidence/m4-slice1-r5-r10-corrections-2026-10-16/](evidence/m4-slice1-r5-r10-corrections-2026-10-16/) contains:
- `failed/` (before-fix and on-reviewed-source runs);
- the R9 diagnostic;
- `final/` (the gate);
- `source-hashes.txt`;
- `SHA256SUMS` covering every file in the folder.

Raw logs are exempt from whitespace checks by the folder's `.gitattributes`. The `*.log` gitignore pattern is overridden by force-adding, so every referenced receipt is tracked.

## Limitations

- **Installed behaviour is unverified.** No real reader, Tauri IPC, Finder or WKWebView behaviour was observed.
- **Large files:** every checked write and verified open now parses the PDF as well as hashing it, inside the write lock for writes. Very large PDFs hold the lock for longer.
- **A bookmark with an unknown origin** is never opened at its page; the panel shows it as unverified with no Open button, and the controller refuses it.
- **The R9 readiness race** was fixed only in the two tests where it was demonstrated. Other tests were not audited for the same pattern.
