# M2 PR2 completion review — controller verified; metadata read recovery remains

**6 October 2026: R11–R13 are independently verified and closed. One PR2 read-recovery defect, M2UI-R14, remains before source integration.** Preserve the completed controller work; no additional panel rewrite is assigned. A narrowly scoped subprocess-test timeout adjustment is justified by the submitted failures, separately from the actual read defect.

## Submission identity and accepted controller work

Implementation root `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-practice-session-ui`, HEAD/base `61031d4c7143fdf181bba2cc18616c5345521c3e`. All **29 source hashes and 28 completion-evidence hashes match**. Independent tests preserved all submitted source/status bytes. Compared with the earlier reviewed manifest, only panel, finishing tests, STATUS and handoff differ. The implementer reported pre-existing in-flight edits and preserved its incomplete evidence directory; this review neither overwrites that directory nor attributes authorship beyond the report.

Independent frozen diagnostic and affected suites: **160 passed, exit0, zero unhandled errors**. This includes the 21 frozen controller cases, 34 permanent finishing cases and prior UI/offline/persistence/startup/browser-recovery/modal positives. R11 lifecycle setup/StrictMode replay, R12 complete frozen-content read handling/held-answer recovery, and R13 owned lock isolation/converse all pass. The additional ready-phase correction passes its meaningful held-answer/content-change case. No temporary diagnostics remain in source.

Native source/proofs are unchanged from the previously reviewed five-pass erasure set. The submitted final sequential gate has raw exit0 receipts for **2,556 frontend passes/4 skips/zero unhandled errors**, **391 Rust passes/6 ignores**, types/build/Clippy/fmt/lock/hygiene/migration integrity. These full/native results are submitted evidence, not independently repeated here; no redundant full matrix was needed to review the changed controller.

Answer-click start with acknowledged ordering remains accepted. The older R5–R10 positives remain accepted. No new start button or PR1 re-audit is required.

## M2UI-R14 — P2: newly added MaterialDetail reads have no rejection handling

**Exact location:** submitted `src/pages/StudyLibrary/MaterialDetail.tsx:198–212`, calls at201 and204. The effect invokes:

```ts
void repositories.practiceSessions.getConversionStatus(materialId).then(...);
void repositories.practiceSessions.getCompletedHistory(materialId).then(...);
```

Neither chain handles rejection. The cancelled flag only prevents success callbacks after cleanup; it does not consume a rejected promise. A failed local metadata read becomes an unhandled rejection, with no visible practice-status retry. completedCount begins at0 and can misleadingly hide history access when its count was never successfully read.

**This is part of the current PR2 diff.** The two reads/effect are absent from accepted PR1 base61031d4. The completion report's statement that the recurring unhandled problem arises entirely in accepted PR1/import code is therefore too broad. The connection owner is where a database failure is produced, not proof of which consumer neglected to handle it.

**Independent deterministic proof:** `codex-pr2-material-read-review.test.ts` renders the real MaterialDetail with AppDataProvider and disposable SQLite. It rejects only the SQL used by each metadata read, one case at a time. Both cases fail to expose visible read recovery, and Vitest records **two unhandled errors** with stacks through `getConversionStatus → MaterialDetail:201` and `getCompletedHistory → MaterialDetail:204`. This does not rely on heavy host load, a real profile or a closed test database. It establishes the application's missing failure handling directly.

The supplied diagnostic expects a button matching `/Retry.*practice/i`; equivalent clearly labeled visible recovery is acceptable. Preserve the rejection-consumption invariant, successful retry outcome and no-provider/no-write boundary when promoting the cases.

**Required correction:** own these two metadata reads in a small loading/success/failure/retry flow. Catch both failures, publish sanitized current-view recovery, and prevent late success/error from old routes/unmounted components from updating the current page. Treat an unknown count as unknown, not successful zero; retain a truthful route to history when count is unavailable. A Retry performs only metadata reads. Keep saved guides/cards and independently loaded frozen practice usable where safe; do not turn this into a new provider request or regeneration. Preserve quarantine warnings after successful status reads. Show no raw SQLite/private path/provider details.

## What the failed full runs establish, and what they do not

The preserved full-run receipt includes timeouts in `macReadinessPreflight.test.ts` (default5s) and `studyLibraryScenarios.test.ts` (30s), plus four database-disabled unhandled rejections attributed while ImportStudyPacketDialog tests ran. A second failure includes the subprocess case alone; subsequent identical-source runs pass. These are real failures, not green receipts. Host contention is reported by the implementer; this review did not independently profile host load.

The direct R14 proof identifies an unhandled consumer in submitted PR2. It does **not** establish that every full-run lifetime error has exactly that cause or prove test teardown is otherwise correct. Fix R14 first. If database-lifetime errors still occur, investigate unfinished reads/transactions and close disposable DBs only after their relevant work settles. Do not suppress rejections, catch errors only in the test runner, weaken connection recovery, or blame all errors on machine load.

`src/logic/macReadinessPreflight.test.ts:536–550` is a functional CLI contract test that synchronously launches three real Node subprocesses, each with an existing60s hard bound, but inherits a5s outer test deadline. Its submitted timeout is enough evidence to permit a **case-local bounded timeout** (e.g.30s) without changing global test defaults, subprocess assertions or production code. This is not a performance acceptance test. Do not enlarge the separate Study Library performance budget merely because one loaded run timed out; retain that failure and investigate only if it persists after the focused fix.

## Evidence and next task

[Frozen evidence pack](evidence/m2-practice-session-pr2-read-recovery-review-2026-10-06/README.md) includes independent160-pass receipt, two-failure/two-unhandled read diagnostic, source unchanged proof, complete source snapshot, submitted completion receipts and preserved partial earlier work. Source/evidence manifests have distinct roots.

Execute the [specific model-neutral read-recovery assignment](M2_PRACTICE_SESSION_PR2_READ_RECOVERY_FIX_PROMPT_2026-10-06.md). This closes R14 and the justified test allowance without reopening verified controller behavior. Application changes remain uncommitted/unaccepted as a complete PR2 until the read recovery and final gates are ready. Existing owner approval persists; no account, provider, packaging, signing or release work.
