# Current-schema Mac verification preparation — model-neutral assignment

Prepare a complete **source-only** verification package for the now-shipped schema 14, and correct the one nonblocking metadata-map edge case from PR #143. This is a substantial preparation task with one coherent deliverable. It does not authorize a build, installation, app launch, profile/account change, signing or release.

## Starting state and ownership

Fetch first. Read `docs/PROJECT_DEVELOPMENT_REVIEW_WORKFLOW.md`, latest STATUS/handoff, `docs/PR143_PRACTICE_DATE_RESTORE_REVIEW_2026-10-11.md`, PR #142's installed-results report and PR #143's actual source/merge identity. Verify PR #143 has merged before building on it; if it remains open, report that dependency and complete independent planning only. Inspect for competing Mac verification-helper work. Reuse an appropriate clean agreed checkout, or create one isolated `codex/` worktree from current main when the protected primary is dirty. Record the actual base and all submitted source hashes before edits. Never reset/stash/clean/pull over another model's dirty work. Do not edit Gemini's active M4 worktree, the separate M3 prompt revision, or the primary's saved Mac documents.

M3-D1–D9 approval persists. M4 preparation/defaults remain separate. Do not reopen their decisions. PR #142's administrator-account synthetic test results are real evidence for its schema-12→13 candidates; they do not grant a new schema-14 installed run or replace the unresolved standard-account/mid-save/signing gates.

## 1. Preserve historical evidence and correct metadata maps

The historical schema-13 helper remains useful for its frozen candidates. Its currently disclosed live-source ceiling alarm is intentional drift; do not suppress it to claim all checks pass. Preserve every frozen `final-helper.mjs`, old installer identity, PR #142 JSON and earlier receipt byte-for-byte.

In the live schema-13 helper, correct `metadataKeyDigests()` to use an own-key-safe map. The current `{}` assignment omits a valid `__proto__` key. Include the same safe behavior in the new current-schema helper. Add real SQLite regressions for `__proto__`, `constructor`, `toString` and normal Unicode keys: capture counts and own keys agree, unchanged/restore comparisons work for retained values, and edits/additions/removals fail where required. Special keys are never receipt exclusions. Preserve exact framing, value-free digests and the three-key restore-only policy. Legacy snapshots without per-key digests remain strict; PR #142's old restore diff stays identical.

## 2. Prepare a current-schema helper with a separate, explicit contract

Create a clearly named current-schema entrypoint/package rather than silently reinterpreting the frozen schema-13 kit. Reuse reviewed logic where that preserves behavior; avoid unrelated rewrites. Bind its declared schema ceiling, migration identities and object inventory to an exact accepted source commit and shipped SQL/checksum bytes. Do not use the old helper's 13 ceiling for a schema-14 candidate, assume M4 candidate 0015 is registered, or weaken an anchor because main moves.

Capture and compare complete facts for populated schema 13→14 upgrades and older schema 12/13 backup payloads restored into schema 14. Inventory the six shipped M3 tables: `skill_catalog_entries`, `skill_catalog_revisions`, `skill_observations`, `skill_observation_revisions`, `skill_self_assessments`, `skill_evidence_operations`, plus all prior retained tables/files and the genuine SQLx migration ledger. Distinguish additive seeded catalog rows from retained user evidence. A no-op upgrade, missing/unsuccessful/wrong-checksum migration 14, incomplete object definition, missing table or unexpected schema must never receive a complete PASS.

Keep strict type-aware digest framing, table/key/column identity, migration-prefix/history rules, managed-file hashes and content-state checks. Unknown/partial snapshots get a clear refusal or explicitly partial result. Reuse the accepted M3 fixtures/validators where useful; do not invent a second weakened schema-14 validity definition. Receipt exclusions stay limited to the exact three post-export keys, disclosed in every applicable result. All other metadata, observations, revisions, operation receipts and file bytes remain protected.

Preserve operational safeguards: read-only inspection, app-stopped/process inspection, approved account/profile identity, fresh non-aliased outputs, symlink/path refusal, bounded inputs and permission recovery bound to the current run and operation. No environment-variable or PATH-based test bypass in distributed code. Test adapters belong only to disposable copies. Do not repoint the operator to the everyday account or broaden an earlier test-lane authorization.

## 3. Prove the contract with genuine disposable data

Use real SQLite databases populated BEFORE upgrades, with existing debrief/practice/card/split rows and representative M3 writer-created observations, revisions, independent status/confidence, explicit links and erased-operation tombstones. Exercise actual migrations and real backup payload/restore fixtures where available. If only a closed synthetic database copy is used, label that boundary honestly; it is not full application backup compatibility proof.

Test retained row/file equality through upgrade/restore; seed-only behavior; unchanged/cancel/failure invariance; wrong/newer/incomplete ledgers; missing/changed managed files; altered non-receipt metadata; changed M3 history/operation data; and restore-only receipt differences. Keep legacy PR #142 failure replay unchanged. Show meaningful sensitivity on disposable copies: selected missing-ledger/incomplete-inventory/exclusion-scope/special-key/retained-data guards removed must fail the correct named regression, not a startup error or unrelated check. Restore/check scratch source hashes.

No physical run is requested. Do not touch `/Applications`, the staged kit, a real app-data folder, test-account permissions, real backups, native signing credentials or any provider. Fixture/proof writes belong in disposable temporary roots only.

## 4. Complete the handoff

Deliver the helper(s), permanent focused tests, complete report, runnable proof runner, exact commands/runtime/cwd/stdout/stderr/exits, issue-to-test map, source manifest and final evidence checksums generated AFTER receipts. Use Node 22 for the normal project lane and disclose any other runtime. Run focused verification, relevant type/build checks if app-shared code changes, and migration/lock/hygiene checks. No unrelated whole-app matrix or old-WKWebView claim is needed for pure scripts/docs; broaden only for an actual change/failure.

Provide one canonical future human walkthrough with consistent variables and supported commands. Pin future candidate identity only when one actually exists; otherwise state that the schema-14 installer/hash/version/lane is unavailable and list the narrow inputs the later operator will need. Never reuse, overwrite or retarget the frozen v0.5.3 candidate. Do not construct a missing candidate or fabricate a successful physical receipt to fill the package.

Update the new report and propose tracking entries while preserving all published history. Explicitly distinguish: PR #142's older installed results; PR #143's source date fix; the new source-only schema-14 helper proof; and still-unverified installed/release gates. Leave changes uncommitted/unpushed for independent senior review. Summarize file identities, measured results, remaining limitations and precise future human steps, then stop. Do not start M4 production or another roadmap milestone.
