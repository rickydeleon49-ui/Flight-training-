# Gemini: correct Slice B preparation before source implementation

Continue in `/Users/rickymac/code/Flight-training-` on the existing dirty branch `codex/structured-study-import-slice-b-preparation`, HEAD/base `3efe95316b200848178033a68d057f66815cf427`. Correct the documentation package for **BPREP-R1–R3**. Leave all work uncommitted/unpushed for Codex review. No production implementation is assigned.

## 1. Verify and preserve the reviewed state

Fetch/read `docs/STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_REVIEW_2026-10-03.md` and its evidence from origin/main with `git show` or GitHub. Codex publishes that review separately; do not switch, reset, stash, clean or merge this dirty preparation branch to access it.

Codex verified all seven entries in your submitted receipt across eight files including the receipt itself. Receipt SHA-256 is `42fae59b644182400db2aada711084e32884e374104a7c5197ef2b7614aedb1d`. Verify those bytes before editing; explain/preserve any intervening change. Keep original report, conditional prompt and receipt as inert dated snapshots, or rely explicitly on Codex's verbatim snapshots while preserving your reviewed receipt locally. Keep source, tests, fixtures, dependency manifests, lockfiles and Slice A evidence unchanged.

Read your report/prompt beside current sqlJsDb.ts, db.ts, tauriDb.ts, documentRepository.ts, AppDataContext.tsx, Slice A DTO/limits/semantic/payload modules, the accepted contract/handoff and A2-R6/R7. Rewrite one coherent plan; do not patch correct source to make earlier descriptions true.

## 2. BPREP-R1: design observable durable persistence and recovery

Existing `save(db)` catches export/storage errors. A caller catch around it cannot observe those failures. Specify a proposed throwing persistence boundary or a separate throwing path with clear ownership and its relationship to ordinary adapter saves. Keep implementation gated on accepted A2; do not independently overwrite the Windows owner's fixes.

Define when a pre-operation snapshot is captured, what owns the live sql.js handle, how every select/execute/persist/atomic operation sees a recovered handle, and how access is serialized through transaction, durable flush and recovery. A SQL rollback works before commit; after commit, recovery needs an explicit pre-operation state restoration strategy. Describe which prior storage bytes remain untouched and how recovery preserves unrelated records and later saves. Do not claim that `db = new Database(snapshot)` updates a captured const or other closures automatically.

Specify export and localStorage failures separately, snapshot/recovery failures, bounded retry, and the returned error/result. Explain how an idempotent retry cannot return durable success for a prior in-memory-only commit. Define concurrent/autosave behavior so restoring a snapshot cannot erase another successful operation. Tie the chosen design to the eventual accepted A2 API rather than treating the current error-swallowing helper as that API.

Add planned real-sql.js tests asserting live reads, persisted bytes, reopen behavior, unrelated rows, recovery ownership and retry. Do not execute real app storage or change production code during this correction.

## 3. BPREP-R2: correct compatibility and gate evidence

Inspect `v0.5.1` tag `2dbf6df3f66b18e087b5842fc554f8e733255a0e`: migrations stop at 8, there is no practice-test panel/domain, and its backup implementation lacks current main's newer-schema guard. The old study-set mapper hardcodes Gemini; that source fact does not prove a schema-10 backup restores safely or all imported questions remain usable. Current backup.rs does not retroactively protect older binaries.

Rewrite D3 and its conditional approval wording. Present label behavior as a source observation, downgrade/restore usability as unverified, and waiting for M2 as an alternative needing future migration/restore proof. Remove claims of guaranteed successful older restore, fully functional tests, universal clean migration-11 rejection, or measured rare downgrade frequency. Keep the owner's decision pending. No held binary launch, installed test or owner-profile access is requested.

Correct stale “all 52 PR heads” wording. Give the actual commands, date, count and scope of checks performed. Codex's 62-PR metadata inventory and live branch names found no A2-named match and zero open PRs; this is not a source audit of every PR. Distinguish repository-recorded Windows-local status from a fresh observation of that machine. Label clean main as the starting state and the current submission as eight dirty documentation files. Cite the real M2 M1-use/check-in gate or any actual owner decision narrowing it.

## 4. BPREP-R3: unify the native contract and complete the test specification

Define one proposed TypeScript/Rust/IPC operation shape. Resolve `operationId` versus `materialId` and choose a single stable success/failure shape with fixed privacy-safe codes/messages. Label every future method as proposed and cite existing precedents separately. Keep the accepted import payload and complete fixed material defaults; packet data cannot set file metadata, links, tags or other material fields.

Give a native validation table for every DTO field/invariant: ID/hash syntax, normalization policy, unknown fields, complete code-point/array limits, substantive nonempty content, notes retention, consistent titles, import provider/empty model, null sourcePage, valid options/answer index, and field presence. Define how native rejection behaves when JavaScript validation is bypassed. Reuse accepted limits; do not invent a new format or migration.

Define equality using actual material title and nullable study-set/test contents, including source notes, provider/model and answer data. Explain how contentHash is validated/recomputed or otherwise checked without trusting it as proof. No new stored hash column is assigned. Include unchanged/forged hash with changed content, title-only/notes-only differences, absent-versus-present aids and existing-material collisions. Resolve the diagram/prose disagreement.

Preserve all 22 existing test IDs and add a requirements-to-test map. Cover each insert failure in both engines, commit/export/storage failures, queued/concurrent writes, bounded lock retries, operation-outcome uncertainty, guide/cards-only and questions-only saves, notes, preview disclosures, double click, picker cancel, every pre-save cancellation and nested A3 modal lifetime. Match refresh tests to actual `mutate`: successful result plus lastError after a refresh failure, not a thrown refresh exception. Specify current WKWebView, early macOS 12, VoiceOver, offline restart and backup/restore as future installed checks with account/signing prerequisites. Keep all unexecuted rows labelled planned.

Fix future verification commands: scoped Node22/rustup PATH and SDKROOT `/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`; focused checks first, then one sequential full gate after source corrections; locked Rust test/Clippy, `--all-targets -- -D warnings`, fmt check and `npm run test:cargo-lock`. Do not run that full matrix for this documentation correction.

## 5. Reconcile, verify and hand back

Correct the report, conditional implementation prompt, evidence README/receipt, STATUS, PROJECT_HANDOFF and Mac tracker. Mark the package corrected but pending Codex re-review; preserve Slice A acceptance and every B/C/installed/release gate. Check every source anchor, relative link, whitespace and claimed measurement. Regenerate a self-excluding receipt with actual inventory/counts and preserve the reviewed one.

Final handoff: branch/base and review revision; before-edit hash verification; BPREP-R1–R3 issue-to-correction map with exact document anchors; one coherent recovery/IPC/equality contract; expanded stable-ID matrix and unexecuted cases; accurate older-version/gate evidence; unchanged-source proof; final inventory/hash; measured checks and limits.

No production, UI, persistence, migration, new dependency, provider, installed, signing, account, release or Windows-owner messaging work. This assignment completes documentation corrections without asking again for Slice A authorization. Stop for Codex's focused review and publication.
