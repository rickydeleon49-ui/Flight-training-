# v0.5.4 private installed candidate — independent acceptance, 15 October 2026

**ACCEPTED for the selected private local lane, through the containing PR's exact-head checks. No blocking application defect found.** The installed candidate from `fbff255312d3b900f1aa9c64b742cef8d4dd9df5` is suitable for the owner's local testing. This is not public-release, Developer ID, notarization, standard-account, minimum-macOS or VoiceOver acceptance.

## Frozen identity and scope

- Source tree: `713eb74f909367c72b31bdf3da0bf63301256dd1`, identical to accepted #174 head `75d2785`. Full source checks passed on that head and on merged main. This review does not repeat that unchanged full matrix.
- Installed executable: `a809e7b16743c9410b790dfb7634ef4d6aee956f23777aca6d9583bf3a181a8f`.
- DMG: `1048e4636190d07afcbf2da76fc38822cd13189552b03a0ed69265870857676d`.
- ZIP: `7e55ccc7d749be19f526ef0eb083f90672d6d2594a4431b1915ca10596bc1017`.
- All 63 submitted document/evidence files, 55 evidence payload entries and report hash verified before integration. All six candidate checksums and the installed executable matched independently. The original dirty primary submission and older dirty implementation package are preserved.

No application source, migration, dependency, version, app profile or installer is changed by this review. The reviewer did not launch the app, invoke the observer, or access the owner's library/key. Native evidence below was executed by the implementer and independently inspected by the reviewer.

## Installed evidence and independent checks

The submitted native screenshots and raw window/frontmost-process observations support the local Added/Last reviewed labels, Settings safety-copy dates/confirmation, DataRecovery dates/confirmation, automatic restart and usable restored windows. Schema13 and schema12 logs show the other app frontmost with the new process running, then the exact candidate becoming frontmost without additional activation input. Sample intervals are approximate, not precise latency guarantees. The original DESKTOP-V054-02 no-window observation remains unexplained; none recurred here.

The reviewer reran **26 helper tests**, **57 focused tests** (daily-plan logic, rendered persistence/rollover and current-schema verification), and the Cargo-lock check: all passed. The 57 include the eight current-schema wrapper cases. No overlapping full matrices or app rebuilds were run.

Independent offline verification used only preserved synthetic roots and in-memory expected databases. It applied the actual shipped migrations to each fixture and checked **all schema-object definitions**, the exact ledger coverage 1–14, every retained ledger column, added migration checksums/success, new seeded table contents, row multiplicities, every managed PDF, database integrity and foreign keys. Schema13 was rechecked from the safety copy made immediately before schema12 restore; schema12 was rechecked from the final stopped synthetic root. Schema14 was rechecked from the safety copy made after the later deliberate Mark reviewed action. That later copy differs only in that material's `last_reviewed_at` and `updated_at`, matching the action's recorded timestamp. The earlier submitted schema14 snapshot records the pre-action exact match. These are distinct observations, not a claim that the later copy is byte-identical.

### Schema12 daily-plan difference: accepted expected runtime behavior

The raw `restore12-compare.json` correctly reports `retainedRowsIdentical: false`. Keep that verdict and all earlier failed/tool-corrected receipts unchanged. There is no new blanket metadata exclusion.

The sole retained-row difference is `app_metadata.daily_plan_session`. The plan advances from 11 October to 15 October; only `date`, `suggestedIds`, `targetCapacity` and `updatedAt` change. The 20-minute preference and decisions are retained. `rolloverDailyPlanState` explicitly refreshes a different local day's session, and `useDailyPlan` persists the displayed session on first open. Existing logic and rendered persistence tests passed independently. No source record, ledger row or PDF changed.

This is an expected post-restore application write, not a restore/migration data-loss defect. Accept the observed result with that explicit disposition; do not rewrite it as universal row equality or disable daily rollover to obtain one. The original comparison script is a historical receipt tool, not a general certification gate: its Boolean summary alone cannot establish required new-ledger coverage or exact new-schema definitions. The independent checks above established both for these actual restored libraries.

## Preservation and limits

The implementer's handoff records normal Cmd-Q and stopped-process checks, return of the same default-profile inode/owner/mode, and no key access/provider calls. The reviewer independently found no app process running, but did not hash the returned owner profile or key. The one corrected reviewer scratch assertion initially expected an additional review-status change; actual data correctly showed only the two timestamp changes stated above. This was a review-tool expectation correction, not an application change.

Gatekeeper still reports `rejected`, exit3, for this ad-hoc app. No bypass was used. Signing/notarization/publication remain deferred. Standard-account/hfdtest, minimum supported macOS, VoiceOver, erasure/tombstone UI and native mid-save fault injection remain unverified. The agreed administrator UID501 synthetic-data lane must not be relabeled as those passes. Several installed copies share the bundle ID; never use an old binary with a schema14 library.

Raw first-session whitespace is preserved with exact-file attributes confined to this evidence directory. Native screenshots are explicitly included despite the repository's image-ignore rule. Frozen submitted tracker/helper versions are retained under the independent evidence folder; only the current helper tracker inventory is refreshed during integration. No database, profile, backup archive, credential or native binary is committed.

Next: [local-use handoff](MAC_V054_LOCAL_USE_HANDOFF_2026-10-15.md). All eight approved improvements remain queued after v0.5.4 in their existing order. There is no further implementation or candidate rebuild required by this review.
