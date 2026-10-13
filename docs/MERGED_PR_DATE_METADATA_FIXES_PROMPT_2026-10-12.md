# Merged-PR maintenance: date-test time zones and metadata keys

**Owner-authorized, queued / not implemented — 12 October 2026.** The owner requested both merged-PR findings be fixed and permitted them to be queued on the roadmap for an agent. Claim the work with the current Git coordinator before editing shared files.

## Scope and identity

Complete these two bounded corrections in one reviewable change. Start from current accepted main, recording the base commit and clean/dirty state. The audited main was `8a260c0b32bc213850ed85bf9488d6ef571354a9`; fetch and recheck rather than assuming it is still current.

Use the agreed clean checkout or an isolated `codex/` branch. Preserve other agents' changes. Do not pull/reset/stash/clean over a dirty checkout. Do not edit Gemini's M4 evidence work.

Read `docs/PROJECT_DEVELOPMENT_REVIEW_WORKFLOW.md`, current ROADMAP/STATUS/handoff and `docs/MAC_SCHEMA14_VERIFICATION_PREPARATION_PROMPT_2026-10-11.md`. The latter already assigns the metadata-map correction. Coordinate one owner: if that task is already implementing it, contribute the date-test fix and reuse/review the resulting metadata correction rather than making a competing patch.

## MAINT-143-TZ — deterministic date tests

Affected files: `src/lib/dates.test.ts` (especially lines 9, 14 and 54) and `src/pages/StudyLibrary/PracticeHistoryDates.test.ts` (line 111) at the audited source.

Reproduction, with the committed dependencies installed:

```sh
TZ=Pacific/Kiritimati node node_modules/vitest/vitest.mjs run src/lib/dates.test.ts
TZ=Pacific/Kiritimati node node_modules/vitest/vitest.mjs run src/pages/StudyLibrary/PracticeHistoryDates.test.ts
```

The audit used Node 22.23.3: date helpers 3 failed / 4 passed, exit 1; practice-history dates 1 failed / 2 passed, exit 1. Noon UTC is the following local day in UTC+14. Production `localDayOf()` correctly returns October 4; both suites incorrectly demand October 3. Correct both test fixtures. Do not change production date semantics to satisfy that assumption.

Make the assertions deterministic by explicitly controlling their test time zone, or use an equally clear isolated subprocess approach. If hooks change `process.env.TZ`, restore the exact original state afterwards, deleting the variable when it was originally absent. Do not globally force the application or all unrelated tests to UTC.

Retain timezone-sensitive behavior coverage: use a fixed local zone and a timestamp crossing its local/UTC date boundary, with a literal expected calendar day. Keep bare calendar days unchanged and malformed timestamps refused. Avoid replacing the tests with assertions that merely duplicate the implementation.

Acceptance:
- Relevant date, Notes and practice-history date suites pass when launched under UTC, America/Los_Angeles and Pacific/Kiritimati.
- Local-day behavior still shifts dates correctly; calendar-day inputs do not shift.
- No application date helper or UI behavior changes are required.

## MAINT-143-KEYS — preserve every legal SQLite metadata key

Affected file: `scripts/mac-schema13-profile-snapshot.mjs`, `metadataKeyDigests()` (lines 683–695 at the audited source).

The map starts with `{}` and assigns database keys through bracket notation. A real SQLite table with one text key `__proto__` produces rowCount 1 and zero own digest keys. Snapshot validation then refuses the otherwise valid profile. This is a fail-closed verification defect, not a demonstrated restore data-loss or false-PASS defect.

Use an own-key-safe map, such as `Object.create(null)`, without changing digest framing, ordering, row counts or JSON round-trip behavior.

Add meaningful real-SQLite regression coverage for `__proto__`, `constructor`, `toString` and a normal Unicode key. Verify:
- Captured row counts and own digest-key counts agree; serialization/deserialization retains every key.
- Identical snapshots and genuine schema12→13 restore comparisons work with those keys present.
- Changes, additions and removals of those non-receipt keys still fail applicable comparisons.
- The only restore exclusions remain the exact three `last_complete_backup_*` receipt keys.
- Unchanged/history contracts remain strict; legacy snapshots remain strict.
- Reverting only the own-key-safe map causes the special-key regression to fail.

Prefer the helper's existing scratch self-check framework or a narrowly scoped test harness. No test adapters or configuration bypasses may enter the distributed operator. Test only disposable synthetic SQLite databases/profiles.

Preserve every frozen historical helper, installer identity, PR #142 JSON and previous receipt. The live schema-13 helper's schema-ceiling alarm against current schema14 is already documented and intentional; do not suppress it, change the historical ceiling or misreport a full self-check PASS. Report the exact remaining expected failure separately from the new regression results.

If the broader schema14 task runs first, carry this safe-map coverage into its current-schema helper and review the legacy-helper fix once. Do not duplicate that task's full implementation here.

## Verification and delivery

Run focused regressions first. Demonstrate the date suite fails on the original source under UTC+14 and passes after the fix; demonstrate the original metadata map fails the new special-key case. Reuse the audit reproductions where appropriate.

Run the relevant existing frontend suites, typecheck, helper syntax/self-check and whitespace checks. Keep checks proportional: no application rebuild, installed run or native matrix is required for these test/helper corrections. The actual implementation PR must still pass its required GitHub workflow before integration.

Deliver a concise report with changed files, exact commands/exits/counts, regression sensitivity and any historical helper limitation. Update the two roadmap items to corrected/pending review only when implementation and evidence exist; mark them complete only after acceptance/integration. Leave implementation uncommitted and unpushed for the independent reviewer unless the owner explicitly assigns Git coordination.

No dependency adoption, registered migration edits, backup-format changes, account/profile access, signing, release, installer changes or new M4 work.
