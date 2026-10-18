# Independent review: GEN-REL-01 (send less, reuse PDF preparation)

You are the independent reviewer. Review the uncommitted GEN-REL-01 implementation; do not implement GEN-REL-02 to 05 and do not resume the scheduler work. Owner approval of the GEN-REL priority and of GEN-REL-01's defaults is recorded in `docs/GENERATION_RELIABILITY_PLAN_2026-10-18.md` and does not need re-asking.

## Where it is

- **Worktree:** `/Users/rickymac/code/Flight-training-gen-rel-01`, branch `claude/gen-rel-01`, HEAD **45b4e2a09c0cd0ec3751ea689abea0f0855c2c60** (current main). Work began on 2e3f7fe; the fast-forward to 45b4e2a changed only documents, trackers and the schema-14 manifest.
- **State:** every change is **uncommitted and unstaged**. Before reviewing, confirm `git status` and the hashes in `docs/evidence/gen-rel-01-2026-10-18/source-hashes.txt`. If they differ, inspect what changed before relying on the receipts.
- **Report:** `docs/GEN_REL_01_IMPLEMENTATION_REPORT_2026-10-18.md`, which holds the acceptance map, measurements, gate and limits.
- **Evidence:** `docs/evidence/gen-rel-01-2026-10-18/`, containing `failed/` (pre-fix and environmental), `final/` (the gate) and `SHA256SUMS`.

## Read first

1. The assignment and plan: `docs/GENERATION_RELIABILITY_FIRST_IMPLEMENTER_PROMPT_2026-10-18.md` and `docs/GENERATION_RELIABILITY_PLAN_2026-10-18.md`, especially the GEN-REL-01 acceptance table.
2. `git diff` plus the new files:
   - `src-tauri/src/gemini_files.rs` (transport, contract validation, cache);
   - `src-tauri/src/gemini.rs` (`GenContext`, `run_generation`, the encoded inline limit, context invalidation);
   - the tests: `gemini_files_tests.rs`, `gemini_generation_tests.rs`, and `fake_gemini.rs` (the test-only loopback server);
   - `src/logic/aiSafety.ts` (`geminiSendDisclosure`), `src/components/ui/Dialog.tsx` and `src/pages/StudyLibrary/MaterialDetail.tsx`;
   - `MaterialDetailSourceChoice.test.ts` and `README.md`.
3. Google's primary documentation for the Files API and `generateContent` `file_data`. Check the contract the code relies on: resumable start, then upload+finalize; `files.get` and `files.delete`; `PROCESSING`/`ACTIVE`/`FAILED`; 48-hour retention. Use no live call and no owner key.

## What to verify

1. **No inline PDF and no fallback.** Prove that no code path embeds a PDF inline or falls back to repeated whole-file sends. Check `run_generation`, `source_part` and every error branch.
2. **Cache identity.** The key is key-hash, endpoint, content SHA-256 of the bytes read now, MIME type and the selected stored path. Look for any way a changed file at the same path and size, another source, another key or another endpoint could hit an old entry, and for any place the raw key could be stored or logged.
3. **Concurrency.**
   - Coalescing must hold no lock across an await.
   - Epoch handling on disconnect or key change: a late completion and its waiters must never publish into, or use a copy from, a new context.
   - `FlightGuard` must release waiters when a preparation is dropped.
   - Look for a path where a waiter receives a copy that is then deleted.
4. **Bounds and recovery.**
   - Polls, the reuse margin and the expiry fallback must be bounded.
   - "Re-prepare exactly once" must hold in `prepare` and in `run_generation`, with no retry loops. A lookup failure must not turn into an upload.
   - A healthy-copy refusal must stay as Google's refusal; check the 400/403/404 heuristic for false re-uploads.
5. **Provider references.** URI must equal `{base}/v1beta/{name}`, the name pattern must hold and the upload URL must keep its prefix. No arbitrary URL may be followed.
6. **Cleanup.** Only this cache's files are deleted, by name and with the creating key, bounded, and never enumerated. Cleanup must not turn a success into a failure. Check that the retention disclosure in the Send text matches the code.
7. **Privacy.** No key, source content, local path, `files/…` name or upload session id may appear in messages, logs, SQLite, backups or evidence. Scan the evidence folder too.
8. **Interface.**
   - "Choose a chapter or pages first" opens the existing manual split and sends nothing; there is no auto-generation after a split.
   - Whole-document sending is still available.
   - The shared lock and the request/session-owned save guards are intact.
   - A part is sent alone and saved to the part, with its page not remapped onto the original.
   - Failure keeps saved content and history.
   - Wording follows `PRODUCT_SPEC.md`.
9. **Encoded inline limit** for images and text: check the arithmetic and that PDFs keep Google's 50 MB / 1,000-page limit.
10. **Evidence.** Receipts must be raw. Pre-fix failures must be kept separately. The helper's first failure (editor `flycheck0` in `src-tauri/target`) must be honestly classified. Measurements must make no speed or reliability claims. SHA256SUMS must verify, and every referenced file must exist.
11. **Untouched:** migrations 1+ and checksums, dependencies (Cargo.toml/lock, package/lock), the version and release config. Only the current schema-14 completion manifest was rebound, to the edited trackers; historical receipts are unchanged.

## How to run

Use Node 22 (`PATH=/opt/homebrew/opt/node@22/bin:$PATH`) and scope `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` to cargo commands; do not change global toolchains.

Focused runs:
- `cargo test --locked --manifest-path src-tauri/Cargo.toml gemini -- --nocapture`
- `npx vitest run src/pages/StudyLibrary/MaterialDetailSourceChoice.test.ts src/pages/StudyLibrary/MaterialDetailGemini.test.ts src/pages/StudyLibrary/SplitLineage.test.ts`

Then reproduce the gate commands in the report. Delete any editor-created `src-tauri/target/flycheck0` before the schema-14 helper suite; it is regenerable build output.

Diagnostics you add go in a disposable copy or are removed afterwards; keep any failing receipt you produce. Use synthetic data only: no app launch, profile, real provider call, private upload, signing or release.

## Output

Write `docs/GEN_REL_01_REVIEW_2026-10-18.md`, either accepting or listing numbered findings (GENREL01-R1…) with severity, exact file and line, a reproduction (a frozen failing test where possible) and the required fix. Record identity, hashes and commands with exits. Do not merge or enable auto-merge; the owner controls integration. Do not start GEN-REL-02.
