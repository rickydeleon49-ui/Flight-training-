# A2 independent third review — 3 October 2026

**Decision: request corrections; A2 source is not accepted for commit, push or merge.** R6/R7's original five reviewer diagnostics now pass, but two further P2 contract failures are reproduced on both real single-connection engines. This publication contains review documents and diagnostic evidence only. The production implementation remains uncommitted in its Windows owner's checkout.

## Identity and scope

- Repository: `https://github.com/rickydeleon49-ui/Flight-training-`.
- Implementation: Windows-local `fix/atomic-study-material-saves`, base/HEAD `533a8f50c2d0de74a75f5542022da3182f376ee9`, with 15 modified tracked files and eight untracked paths. The fixture directory contains two files.
- Independent reviewer/Git coordinator: Codex. The existing Windows implementer owns corrections. No implementation file was changed by this review.
- Cross-machine baseline inspected: main `30a67faab3db89d15f2a92b1e5a5ff534fa9e09c` (PR #67). It is newer than the implementation base.
- Review executed on Windows with Node `24.16.0`, Node SQLite `3.53.0`, sql.js `1.14.2`, Vitest `4.1.11`. All data was synthetic. This is source/development-driver evidence, not an installed Windows or Mac test.
- All **24 submitted SHA-256 receipts matched**. A 307-file isolated snapshot was taken; all **307 owner files remained unchanged** at review end. See the [receipt and source hashes](evidence/a2-third-review-2026-10-03/README.md).

The native source, native tests and shared material-save fixtures match the previously reviewed bytes. This correction review independently reran the database-sensitive frontend cases and exercised the Mac preparation diagnostics on the Windows snapshot. It did not repeat the full Rust/build matrix once known focused failures were established. The implementer's reported full matrix is recorded as reported evidence, not a new Codex run.

## R8 — P2: a CASE expression prematurely ends trigger scanning

**Location:** `src/data/connectionOwner.ts:165`–168 (`hasTransactionControl`). Applies to the node:sqlite test driver and development-only sql.js browser driver, not the desktop's native material command.

The scanner sets `inTrigger` for `CREATE TRIGGER`, then clears it at the first unquoted `END`. An `END` belonging to a `CASE` expression in the trigger's `WHEN` clause or body therefore closes the scanner's trigger context. After the next semicolon, the actual trigger terminator is mistaken for public transaction control and the driver refuses valid SQL.

Reproduction:

```sql
CREATE TRIGGER case_body AFTER INSERT ON unrelated
BEGIN
  INSERT INTO observed (value)
    VALUES (CASE WHEN NEW.id = 'probe' THEN 'kept' ELSE 'other' END);
END;
```

A second case puts `CASE ... END = 1` in `WHEN`. Raw `DatabaseSync.prepare(...).run()` and sql.js `run(sql, [])` accept both definitions and fire them when the probe row is inserted: **four raw-engine controls pass**. The same SQL through each public driver's `execute` rejects with the atomic-operations error: **four driver regressions fail**. See the [unchanged assertions and logs](evidence/a2-third-review-2026-10-03/README.md).

**Required correction:** distinguish trigger-body termination from nested `CASE` expressions and ordinary identifiers, while retaining comments/quotes/statement-boundary handling. Do not ignore everything after `CREATE TRIGGER`: a real transaction statement after the completed trigger must still be refused. Preserve the original opening/ending/queued-control regressions. This is a compatibility failure in the new guard, not evidence of installed-desktop data loss.

## R9 — P2: partial updates persist display normalization into omitted columns

**Location:** `src/data/materialTransaction.ts:244`–264 and the full-row UPDATE at 268 onward.

`handleUpdate` first passes the stored row through `mapRow`. That function uses `toEnum` fallbacks and converts empty optional text to null. The update then writes every field, including fields absent from the operation. A title-and-tags-only edit therefore changes unmentioned stored data:

| Stored value before title/tag edit | Stored value after |
| --- | --- |
| `topic = 'synthetic-topic'` | `'general'` |
| Other unknown stored material type/status/priority strings | Their display defaults |
| `original_file_name = ''` | `NULL` |
| `last_reviewed_at = ''` | `NULL` |

The shared schema permits those stored strings. Empty optional text is also accepted by the material-create API used in the new regression; this case does not depend on an unknown enum fixture. All current recognized enum values remain unaffected by this particular issue.

The prepared **AR-02** cases fail on both engines because `topic` changes outside the update contract: **179 pass, two fail** in the complete 181-case package. Four extra reviewer cases compare every raw material column except the requested title and permitted `updated_at`: all four fail, covering unfamiliar stored enums and API-created empty optional text on both engines.

**Required correction:** update only explicitly supplied columns plus `updated_at`, or merge against raw stored values without applying display normalization to omitted fields. Keep normalization at the presentation/return boundary. Preserve omission versus explicit null, tag omission versus `[]`, title validation, transactions and rollback. Do not weaken AR-02 to a recognized enum just to make it green. The native implementation reads and retains raw strings; that native behavior was inspected here, not newly tested. The JS implementation carries forward a normalization hazard from the old repository path, but still fails the new atomic contract and driver parity.

## Evidence corrections required in the implementer handoff

1. The reported filter `vitest run src/data/singleConnectionDrivers.test.ts -t "reviewer regression"` selects **zero tests** in the submitted bytes: exit 0, **33 skipped**, 458 ms. It cannot substantiate the claimed five-test pass. The five original reviewer diagnostics were independently executed unchanged and all pass in the combined review run; use those actual names/receipts.
2. The Mac acceptance IDs were mapped incorrectly. **PREP-R1** is coherent single-statement observation/barrier validation; **PREP-R2** is complete-state/raw-link observation and precise FK proof; **PREP-R3** is full expected/prior update outcomes. They are not native attachment corrections. **QT-08/09/10** cover public execute/select/multi-statement opening controls; **QT-11a/b** cover ending calls outside/inside ownership; **QT-12** covers legitimate SQL; **BD-01/02** are create/update export failures; **BD-11** is recovery failure. Use the [accepted source matrix](MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md#4-acceptance-matrix) by actual ID/title.
3. An old A2 status paragraph says A3–A6 all remain open. Current main has progressed; reconcile only the A2 status with current main and retain newer accepted Mac work. `src/data/db.ts` currently contains only the intended additive interface difference from main, so a db.ts conflict is a possibility to inspect, not an observed conflict.

## Independent verification receipts

All commands used the already installed owner dependency tree from the isolated snapshot. Exact command arguments and sanitized logs are in the [evidence README](evidence/a2-third-review-2026-10-03/README.md).

| Check | Result | Duration / limitation |
| --- | --- | --- |
| Six maintained focused files + unchanged five diagnostics + eight R8 cases | **93 passed, four failed**, eight files | 3.19 s. Maintained subset: 84 pass; original diagnostics: five pass; R8: four raw controls pass/four driver failures. |
| Shared 181-case preparation package, no assertion/import changes | **179 passed, two failed**, no skips | 5.09 s. Failures only AR-02 on each engine. All 57 conditional seams were reached and passed. Windows execution only. |
| Four new R9 cases, filtered to omitted-column preservation | **Four failed, eight skipped** | 482 ms. Eight R8 cases were excluded by this focused filter, not claimed passed again. |
| Literal handoff five-test filter | **Zero run, 33 skipped**, exit 0 | 458 ms; inaccurate receipt reproduced. |
| Handoff hashes / owner preservation | **24/24 match; 307/307 unchanged** | No owner implementation mutation. |

The first test startup was blocked from writing Vite's cache through the dependency junction by the sandbox (`EPERM`); no test body ran. It was rerun with approved cache access. That startup attempt is preserved separately and is not counted as a product failure.

## Next action and limits

Use [the Windows correction prompt](GEMINI_A2_R8_R9_CORRECTION_PROMPT_2026-10-03.md). Reproduce first, add maintained regressions, fix R8/R9, run focused tests after each correction, then one complete local gate and return uncommitted for independent review. Do not commit/push failing production source simply to make it accessible on the Mac. This documentation publication does not unblock Slice B's accepted-source prerequisite.

After source acceptance, Codex integrates it with then-current main, preserves all Mac changes, validates the integrated tree, publishes through one reviewed source PR and waits for exact-head CI before merge. The Mac owner then reruns the matching accepted source and records Mac results separately. These Windows runs do not certify APFS, WKWebView/macOS 12, Finder/native panels, signing or installed-app readiness. Windows distribution remains held on v0.5.1; v0.5.2 remains retired; frozen v0.5.3 remains held. No release/version/artifact change is authorized by this review.
