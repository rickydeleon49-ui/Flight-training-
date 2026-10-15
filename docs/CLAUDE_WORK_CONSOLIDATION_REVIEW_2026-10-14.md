# Claude work: independent review and consolidation — 14 October 2026

**Verdict: accepted for integration after the corrections below; merge requires successful CI on the exact final consolidation head.** The owner explicitly authorized reviewing Claude's work, merging accepted changes, updating the roadmap and cleaning completed local work. The attached handoff is submission evidence, not a restriction against that newer instruction.

## Reviewed scope and provenance

Base: `42077ccd00b70ad406e30d236a34e0ab556745d5`, main after #160. Inspected actual diffs, callers, tests and reports, not just summaries. Three original uncommitted packages were archived and hash-verified before changes: bug sweep **24 paths**, cost analytics **9 paths**, requirements proposal **1 path**. Source worktrees remain independent from this consolidation branch until recoverable cleanup. No shared node_modules symlink is committed.

| Work | Independent decision |
| --- | --- |
| Nine-defect bug sweep | Accept the calendar-day backup fixes, local backup filename, unambiguous history timestamp, changed-flight-time consistency checks, finite toolkit normalization/shared reminder bounds, same-date medical deduplication, positive lesson-cost guards, cancellation-estimate refusal and short-date year suffix. Existing invalid flight times are not silently rewritten or allowed to block unrelated Quick debrief edits. |
| M5 cost analytics | Accept event-grouped lesson counting, consistent average denominator, cost/hour paired to the same lessons' journal time, visible possible-double-count warnings, six-month expense table and removal of one-off costs from hourly extrapolation. No automatic transaction deletion/deduplication; refunds and unlinked hours remain explicit limitations. |
| M5 requirements | Publish **as a proposal only**, with the inference corrections below. RQ-D1–D7 and knowledgeable human rule review remain pending; this merge implements no rule engine, schema or eligibility claim. |
| #152, head `d02a4aab29afac28e4b06e461fd603ab1cf97e92` | Accept timezone-test correction, including exact environment restoration. Preserve both its rewritten tests and the bug sweep's appended short-date cases. |
| #153, head `aca8900f742dcc8c51282c9210c87c2cfc3842f9` | Integrate the owner-approved local unsigned v0.5.4 route and continuation. Signing/public publication remain deferred. |
| #158, head `6cece54fd26ee593b9ab35bb945d7ffec58ad645` | Integrate the earlier independent #154/#155/#157 review and receipts unchanged. Its manifests describe that earlier reviewed source, not the later consolidation tree. |
| #161, head `4ab1a1582cf974ff81a0f073872565bcc585894b` | Production clock source accepted after inspection; repair the asynchronous rendered-test barrier before integration. Do not merge the original red head. Preserve its failed CI receipt. |
| #162, head `e7fe2b83cc15f5ae8bd96d5a94b3c729ac18e945` | Accept hash routing, filename collision refusal, rendered-route checks and truthful OS-dark labeling. All 37 helper tests pass. No product dark theme is added. |
| Already merged #159/#160 | Reviewed scenario-test isolation and library-day recovery diffs. Full frontend verification covers all scenario tests, and material/library clock tests run together. No new actionable production finding. |

One combined final gate avoids repeating the same full matrix across several small PRs. The coordinator will close superseded PRs only after their accepted changes are verified on merged main; source lineage remains in this report and Git history.

## Findings corrected during review

**CI-161-01 — blocking verification failure, corrected.** [Original required CI](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/38687320702) failed three assertions in `CardReviewClockRecovery.test.ts` (3 failed / 3,138 passed / 6 skipped). Twenty zero-duration fake-timer turns do not acknowledge real asynchronous crypto/SQLite work. The replacement waits for observable initial-read/session/rating/retry states using a bounded real-event-loop yield, while leaving the injected review clock unchanged. It does not enlarge test timeouts, retry cases, suppress errors or change production scheduling. A new delayed-digest case exercises real asynchronous work at initial load and deliberate session start. Restoring the original fixed-turn algorithm makes that case fail. Existing session membership, pending operation identity, focus/visibility and no-write assertions remain.

**SWEEP-1014-TZ — regression sensitivity/fixture gaps, corrected.** The submitted filename test could pass the old UTC-date implementation under UTC CI. It now pins Los Angeles and a literal UTC instant that is the previous local day; the old filename algorithm fails under UTC. The three-zone run also exposed an old backup-health fixture that expected two elapsed days even when the new correct local-calendar behavior spans three dates in UTC+14. The ordinary two-day case now uses matching UTC times; a separate literal three-zone test explicitly requires the different local-calendar counts. No production date semantics were weakened.

**M5-RQ-EVIDENCE — proposal inference gaps, corrected before publication.** Raw instrument time does not establish the specified training purpose, and a planned practical-test month does not turn ordinary recent dual time into practical-test preparation. The proposal now preserves unknown outcomes until qualifying evidence is identified, and broadens its overlap-ambiguity rule beyond entries explicitly marked both dual and solo. Checked against [61.109(a)](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-E/section-61.109) and [61.39(a)](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.39); this remains software scope review, not the required instructor sign-off.

**Small integration corrections.** Froze the Finances rendered-test date to eliminate a month-boundary race and corrected stale per-file counts in its report. The initial local merge omitted the short-date test's `describeRelativeDate` import; focused testing caught it and it was restored. The first readiness matcher omitted the existing ` · new` suffix; it was corrected to recognize that exact optional label. Those two integration mistakes are not attributed to Claude. Their failed receipts are retained separately from final results.

## Reviewer verification

Supported lane: Node **22.23.3**, npm **10.9.9**, committed dependency lock. All test databases/profiles are disposable synthetic data.

- Final full frontend: **3,194 passed / 6 skipped**, 138 passing files / 4 skipped, exit 0; **no unhandled errors**, 56.14 seconds.
- Screenshot/setup helper: **37 passed**, exit 0.
- Seven relevant date/Notes/local-day/history/backup suites under **UTC, Los Angeles and Kiritimati**: **73 passed per lane**, exit 0.
- Frontend production build (including TypeScript): exit 0; final TypeScript check also run after the test-only correction.
- Cargo lock synchronization (`cargo check --locked`) and native formatting: exit 0. Rust source, migrations, checksum registry, dependencies and version files are unchanged. No duplicate local native test matrix was run; required CI must execute native tests/Clippy on the exact consolidated head before merge.
- Two decisive reviewer sensitivity checks fail as intended: restored fixed-turn clock wait; restored UTC backup filename. Sources were restored before final verification.
- Whitespace and final evidence inventories checked. [Receipts and source identities](evidence/claude-work-consolidation-review-2026-10-14/README.md).

Build/SQLite warnings are retained in the receipts. The original red PR161 and UTC+14 failure are not relabeled as successful. Local frontend success is not Linux CI, installed WKWebView, signing or release acceptance.

## Roadmap and cleanup

The current roadmap separates accepted source increments, outstanding medical/legacy-time/refund decisions, proposed requirements, the remaining external-controller repair and release prerequisites. The high source-map-js alert is fixed; the medium glib alert remains open. The external controller's bounded CI-repair transition (PIPE-161-01) is not fixed by repairing the application tests; its bundle and pending recovery worktree are untouched.

The primary's two unpublished schema14 notes were hash-verified, preserved on local recovery branch `codex/preserved-primary-notes-2026-10-14` (`5869045`), and carried forward into the consolidation. Primary main was then fast-forwarded without resetting, stashing or discarding the notes. Completed Claude worktrees may be removed only after their source remains recoverable and integrated; active M4, schema14, scope and handoff worktrees remain preserved. The final coordinator handoff records actual merge and cleanup outcomes.

Next implementation priority is the existing saved schema14/metadata verification package, then the reviewed version/source freeze and approved **local unsigned v0.5.4** build. Current version files remain 0.5.3. No installer, app launch, profile operation, signing, provider request or public release was performed by this review.
