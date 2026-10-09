# Mac schema-13 preparation review — 8 October 2026

**Decision: CHANGES REQUESTED on installed-verification preparation.** The accepted split-lineage source and PR #125 remain accepted. This review does not find a new application defect. G1–G3 remain **UNEXECUTED / UNVERIFIED**; the submitted runbook is not ready to hand to the operator unchanged.

## What is independently verified

- PR #125 is merged at `36a7b39acd291cba14be4f137798b3ad6f7272f1`, with its required check successful. Primary HEAD matched that source; its only changes were the submitted report, evidence and tracking documents.
- All eight submitted `SHA256SUMS` entries verify, including both build logs. Both submitted build logs record exit 0; the builds were not repeated by the reviewer.
- Both DMGs were independently mounted read-only, inspected without launching, and detached. Both full DMG and inner executable hashes match the submitted identity; both executables are arm64. Exact commands are in the inspection script, outputs and exits in `package-results.json`.
- All three existing PDF fixtures independently match the submitted full SHA-256 values. The generator specifies A = 10 pages, B = 1,050 pages and C = 60 pages. The existing fixtures are under `/Users/rickymac/code/.qwen/tmp/hfd-schema13-fixtures/fixtures/`.
- The report correctly discloses no installed GUI results and no Developer ID/notarized release. Its recorded in-session owner approvals cover `hfdtest` and fresh local unsigned candidates. They are not evidence that a GUI test ran.

The submitted report and evidence are published unchanged as historical inputs. The original dirty STATUS/handoff are also frozen in the reviewer pack. This review is the current disposition; “physically built and verified” in the submitted report means build/identity inspection, not successful bundle integrity or installed readiness.

## MACV-R1 — Make the profile, upgrade and backup sequence executable [P1]

**References:** submitted runbook lines 13–16, 26, 43–59; `src-tauri/src/storage.rs:19` (`app_root`), `src-tauri/src/lib.rs:27` (database URL), `src-tauri/src/backup.rs:609` (migration-version check).

G1 first launches NEW against a fresh profile, upgrading it to schema 13. G2 then needs OLD against fresh schema 12, and G3 needs OLD against its “own existing schema-12 fixture library.” Both candidates have the same identifier `com.herflightdeck.app`, app name and version. The native storage root comes from `app_config_dir`; no separate profile selector is provided. Merely switching the executable does not select another library. G3 cannot reuse the just-upgraded G2 profile as a schema-12 baseline.

The instructions also omit the actual schema-12 backup export that G3 references, omit an offline way to create practice/card histories, and leave the per-user installation location implicit. PDFs alone do not supply structured questions/cards; provider generation is outside this assignment. “SELECT * ORDER BY rowid” lacks a defined canonical encoding and exact table names; `user_version` is not the desktop migration authority.

**Required correction:** give one ordered walkthrough: OLD first → populate synthetic data through installed UI → complete a practice attempt and rate a card → export genuine schema-12 backup → quit and preserve a complete task-owned schema-12 profile → NEW against that same active profile → verify migration/history and G1 → export schema-13 backup → quit and preserve the new profile → temporarily restore the preserved schema-12 profile for OLD refusal → quit and restore NEW's profile for older-backup restore. Keep all switches explicit and reversible, with neither app running during profile copies. No guessed environment variable, loose live database copy, or old binary pointed at the schema-13 profile.

Use the accepted offline packet `src/testing/fixtures/study-packets/02-flashcards-and-test.json` (three cards/two questions) through Import study packet, plus the PDF imports, with exact UI steps and hashes. Prepare a read-only snapshot helper with deterministic typed serialization and actual tables: `practice_attempts`, `practice_responses`, `card_review_state`, `card_review_events`, plus materials/file anchors. Check the desktop `_sqlx_migrations` ledger and lineage/log tables rather than asserting `PRAGMA user_version = 13`. Before/after history hashes must exclude newly created operations when deliberately testing them; take the upgrade comparison before new activity.

Install only under `/Users/hfdtest/Applications`, with distinct OLD/NEW paths and full-path launch instructions. Verify actual user UID 502, standard-account status, resolved owned data root and candidate hash in that session before launch. Document transfer from staging into that user’s readable files. The account/data may be disposable, but deleting the account is not needed to complete these tests.

## MACV-R2 — Correct fixture expectations and physically achievable cases [P2]

**References:** submitted runbook lines 18–38; `ManualSplitDialog.tsx:71–110,124–134`; `SplitPdfDialog.tsx:60–74,103–113`; `splitSave.ts`.

- Manual A pages 3–7 yields five pages from a 10-page root, not “of 400.” Nested B101–300 → parent20–40 yields a 21-page child with root120–140 **of 1,050**, not 400. These incorrect totals would turn correct behavior into apparent failure.
- Related-part assertions need actual sibling fixtures. Make a second direct child from the same root copy and a second nested child from the same immediate parent copy. Group by source identity/content version, not by selecting the same “20–40 edition”; do not confuse root siblings with immediate-parent siblings.
- Closing before Save creates no receipt/part files. During Save the dialogs disable dismissal and Cancel. Receipt creation and saving run back-to-back without a human pause, so “change the source file after the receipt” is not a reproducible manual instruction.

**Required correction:** state exact expected coordinates, page counts, companion parts and copy-page destinations. A cancel-before-save test must assert no operation/output was created and source unchanged. Separately specify a reproducible installed failure/recovery case using a real reachable condition, including exact observation and cleanup. If receipt-to-save fault injection requires a helper or test seam unavailable in the frozen packaged app, disclose that subcase as blocked/source-covered, propose the smallest separate reviewed seam, and do not award an installed PASS. Do not silently substitute unit tests, browser mocks, or app-close timing for the accepted native pending/reconcile/cancel obligation.

## MACV-R3 — Resolve bundle integrity before operator handoff [P1]

**References:** submitted report candidate table; `receipts/candidate-identity.txt`; submitted runbook lines 11–16; independent `receipts/package-results.json`.

For **both** exact DMGs, strict verification of the executable in its bundle and deep/strict verification of the app return **exit 1**:

> code has no resources but signature indicates they must be present

Signature display shows linker ad hoc signing, `Info.plist=not bound` and `Sealed Resources=none`. This is a bundle-signature verification failure; absence of Developer ID/notarization does not make it a successful integrity check. Hash matches establish identity, not successful bundle verification. The review did not launch these bundles and does not claim this diagnostic alone proves they cannot run.

**Required correction:** preserve the original DMGs and failure receipts, diagnose the packaging/signature state, and produce separately named locally ad hoc signed candidates with successful strict bundle verification, using the already recorded local unsigned/ad hoc lane. Retain source identities `36a7b39` and `2a6a415`, SDK 26.5, and all pre-sign/post-sign hashes/config overlays. Prefer a scoped packaging configuration, not a permanent release configuration change or unnecessary application rebuild. Do not change source/schema/provider behavior, mutate the historical frozen v0.5.3 installer, or overwrite original candidate bytes.

[Tauri’s official ad hoc signing documentation](https://v2.tauri.app/distribute/sign/macos/#ad-hoc-signing) supports pseudo-identity `-`; it does not confer Developer ID trust or notarization. The runbook must record the actual macOS launch outcome rather than guarantee every local unsigned app will be refused and right-click Open will solve it. If macOS blocks this approved local test app, use only the per-app flow available on the actual system, following [Apple’s guidance](https://support.apple.com/en-us/102445); no global Gatekeeper disablement or bulk quarantine removal. Preserve the blocked result if no permitted flow works.

## Evidence and publication requirements

Both build `.log` files are covered by the original manifest but ignored by the repository’s `*.log` rule. This publication explicitly includes those exact files; future submissions must enumerate all manifest entries rather than rely on an ordinary `git add`/visible untracked listing. Originals remain byte-identical, including raw whitespace. The reviewer pack freezes 12 submitted paths and source anchors, independent inspection outputs and exits, fixture hashes and PR evidence, with its own checksum manifest.

One bounded correction assignment closes MACV-R1–R3 and prepares the human run. No broad source gate rerun is warranted for a runbook/package-only change; helpers need meaningful isolated checks, and replacement candidates need strict package/hash checks. Actual physical checks require the human `hfdtest` GUI session. Keep G1–G3 unverified until observed. Source acceptance, local package readiness, installed results and public release authorization remain separate.

The primary dirty checkout was not edited, staged, reset or synchronized over the submitted changes. Publication used the existing clean reviewer worktree. See [the active correction prompt](MAC_SCHEMA13_PREPARATION_CORRECTIONS_PROMPT_2026-10-08.md) and [review evidence](evidence/mac-schema13-preparation-review-2026-10-08/README.md).
