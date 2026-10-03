# A2 atomic Study Library saves — second independent review

Date: 2 October 2026. Reviewer: Codex. **Decision: corrections required; do not commit or push this branch yet.**

Published 2 October as historical review evidence. Repository source changes were not published with this report. All necessary findings, diagnostic test source and sanitized focused logs are now shared here; Windows workspace paths below describe the original run, not prerequisites on another machine.

## Reviewed source

- Repository: `H:\Ai Repo clones\Flight-training-`
- GitHub: `rickydeleon49-ui/Flight-training-`
- Branch: `fix/atomic-study-material-saves`
- HEAD/base: `533a8f50c2d0de74a75f5542022da3182f376ee9`
- Changes remain uncommitted and unpushed. Codex did not alter repository source, commit, push, run GitHub Actions, tag, or publish anything.
- All ten hashes in the implementer's final matrix receipt matched before and after this review. In particular, `documents.rs` = `68e157a96ef679b8c28c2d46f7fe3a78eda31ce191e3e69a1fb2e57af0afa7d7`; `materialTransaction.ts` = `48319066a73db66b78e50d8523c5efaf9b5fe09dedfdc181bc46c03d5bba1f46`.

The source was copied into `outputs/a2-second-review-2026-10-02/snapshot/` in this Codex workspace, excluding ignored dependencies and build outputs. A junction uses the existing node_modules. Diagnostic tests and one cfg(test) module declaration were added only to that snapshot. Rust reused the existing target cache; no real application database or uploaded document was used.

## Findings

### R6 — P2: public SQL can still leave an unowned transaction open

Locations: `src/data/connectionOwner.ts:28`, `src/data/testing/nodeSqliteDb.ts:63`, `src/data/sqlJsDb.ts:140`.

The ownership queue correctly prevents the original mid-save interleaving. However, `refuseTransactionControl` examines only an initial whitespace-prefixed keyword, and `select` does not invoke it at all. The actual SQLite engines accept both of these:

```sql
/* synthetic leading comment */ BEGIN IMMEDIATE
```

```typescript
await db.select("BEGIN IMMEDIATE");
```

The first call succeeds on the node:sqlite test driver. Subsequent public `execute` can acknowledge a write inside that still-open transaction. A material save then fails to open its own transaction; the owner's failure cleanup rolls back the earlier acknowledged write. The queue has serialized the operations, but transaction ownership has escaped an operation boundary.

On real sql.js, public `select("BEGIN IMMEDIATE")` followed by a normal acknowledged `execute` is enough: the execute's export rolls back the open transaction. The acknowledged row exists neither in memory nor after reload.

Three independent tests reproduced this with real engines:

| Route | Observed result |
| --- | --- |
| node:sqlite public execute with a leading block comment | Subsequent save rejected; previously acknowledged unrelated row becomes `[]` |
| node:sqlite public select with BEGIN | Same acknowledged-row loss |
| sql.js public select with BEGIN | Subsequent write reports success; live rows and reopened rows both `[]` |

Required correction: close the public transaction-control boundary for both drivers and every applicable public SQL entry point, preserving legitimate read queries and trigger definitions. A regex that scans every BEGIN word would also reject valid CREATE TRIGGER bodies, so it is not a safe replacement. Add real-engine regressions for the bypasses, preserve the original queue tests, and demonstrate that later writes remain safe after refusal.

Scope: browser development and test drivers. No current UI action issuing these transaction-control strings was identified. This is an incomplete driver contract, not evidence of malicious input or an equivalent native desktop failure.

### R7 — P2: a browser export error leaves a rejected change in the live database

Location: `src/data/sqlJsDb.ts:103`.

`durableWrite` restores the last stored snapshot when work fails or localStorage refuses the bytes. The intervening `exportBytes()` runs outside either recovery catch. If exporting throws after the atomic operation commits, the promise rejects but the live handle still contains the rejected changes. The owner's ROLLBACK finds no open transaction and cannot undo this commit.

Using real sql.js, with a one-time failure injected into `SQL.Database.prototype.export` only after normal driver initialization, reproduced both cases:

| Operation | Last stored / reopened state | Live state after rejection |
| --- | --- | --- |
| Create | No material | New `guide` row exists |
| Update | `guide`, title `Synthetic guide` | Same row, title `Changed guide` |

A retry or a later write can consequently encounter or persist a change that the caller was told failed. The normal quota-error fix passes; this is the missing serialization failure boundary, not the same quota failure.

Required correction: make work, export, connection-setting restoration, encoding and storage participate in a consistent durable-write failure policy. Restore the last stored state before permitting another operation after a rejected write. If safe restoration itself fails, refuse further work instead of leaving the queue on an unsafe handle. Add create/update export-failure regressions, compare rows and tag links in memory and after reopen, and prove recovery/retry is exact. Keep this limited to the browser driver; do not change native transactions to fix a development fallback.

## What is now verified

The original native defects R1–R3 are corrected for the tested Windows scenarios:

- Tag replacement persists the acknowledged tags; trigger failures and ignored inserts cannot silently acknowledge missing links.
- Referenced files survive redundant slash and Windows case aliases; legacy stored spellings and a directory junction are exercised.
- Cleanup-first attachment attempts are refused, while save-first cleanup protects the referenced file. Replacement failure preserves the prior row, tags and file bytes.
- Large original documents remain allowed; split-specific limits were not applied to ordinary imports.
- Shared native/JS contract fixtures pass.
- Real ownership tests now protect ordinary concurrent saves, reads, debriefs, batches and public writes.
- Browser quota rejection restores the live snapshot, retries correctly and survives reopen; foreign keys remain enforced after export.
- The real Study Library page/database tests verify failed-save retry and Cancel's cleanup request. Their native file-service boundary is mocked; Rust tests provide the physical-file evidence.

These are verified improvements. R4 and R5 are not fully closed until R6 and R7 pass.

## Independent validation

All commands below ran sequentially against the isolated snapshot. Logs are in `outputs/a2-second-review-2026-10-02/`.

| Check | Result | Log |
| --- | --- | --- |
| Six frontend files: ownership, shared contract, repository, Study Library integration, form and editor safety | **67 passed**, exit 0 | `frontend-focused.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline documents::save_tests:: -- --nocapture` | **21 passed**, exit 0 | `native-save-tests.log` |
| Original reviewer native regressions, unchanged | **4 passed**, exit 0 | `native-original-review-regressions.log` |
| New ownership and serialization regression file | **5 failed**, exit 1, expected for the defects above | `reviewer-edge-regressions.log` |
| Repository `git diff --check` | Passed | Checked after independent tests |
| Handoff hashes before and after review | **10/10 matched** | `handoff-hash-verification.json`, `after-review-hash-verification.json` |

Frontend passing command:

```text
npx vitest run src/data/singleConnectionDrivers.test.ts src/data/materialSaveContract.test.ts src/data/repositories/documentRepository.test.ts src/pages/StudyLibrary/materialSaveIntegration.test.ts src/pages/StudyLibrary/MaterialFormDialog.test.ts src/state/editorSafety.test.ts --reporter=verbose
```

New reviewer regression source: [five diagnostic cases](A2_SECOND_REVIEW_REGRESSIONS_2026-10-02.md). Sanitized logs and source hash receipts are in [the evidence directory](evidence/a2-second-review-2026-10-02/README.md).

The initial sandboxed frontend launch could not load its configuration through the dependency junction. That was a tool-access startup failure, saved as `reviewer-sandbox-startup-error.log`. The approved rerun loaded successfully and produced the five actual assertions above; the startup failure was not counted as a code regression.

The native case-sensitive-volume test returned early on case-insensitive NTFS and therefore appears as a pass. It is not evidence for case-sensitive APFS or Linux. Measured native writer waits in this run: transient lock **459.77 ms**, permanent lock **5.515 s** for one attempt. The existing four-attempt policy remains roughly 23 s worst case; no speedup or timeout change is claimed.

## Implementer's full matrix receipts

Inspected original logs, not just the prose summary. Copied into `implementer-final-matrix/` in this evidence directory:

- npm ci: exit 0.
- npm test: 62 test files passed, 3 skipped; 629 tests passed, 4 skipped.
- npm run build: exit 0.
- cargo fmt --check: exit 0.
- cargo clippy --all-targets -- -D warnings: exit 0.
- cargo test --locked: 283 passed, 6 ignored.
- cargo lock consistency, release-version consistency and diff check: exit 0.

Those tests accurately pass on the current source, but did not cover R6/R7. An earlier matrix's build type error was fixed before the complete passing rerun. Codex did not rerun an expensive full matrix after discovering known remaining failures; fix and test those first.

## Acceptance and platform limits

A2 remains pending. No CI minutes were consumed and no commit, push, PR, merge, tag or release was made by this review. A1 acceptance and history are preserved. A3–A6 and the open-source adoption work remain separate.

No installed Windows smoke test, physical Apple Silicon test, early macOS 12 WKWebView test, APFS identity test or live Gemini test occurred here. Windows distribution remains held on v0.5.1; v0.5.2 remains permanently retired; the frozen v0.5.3 Mac candidate remains held. Passing source tests and version checks do not establish release readiness.

Next implementer prompt: [A2 correction prompt](A2_REVIEW_CORRECTION_PROMPT_2026-10-02.md).
