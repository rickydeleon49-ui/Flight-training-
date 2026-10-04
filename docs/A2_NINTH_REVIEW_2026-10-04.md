# A2 ninth independent review — 4 October 2026

**Decision: R11/R12 trigger corrections pass. R13 line-comment tokenization still blocks source integration because both development drivers can lose an acknowledged write.**

## Identity and independent evidence

Reviewed the supplied follow-up handoff and actual dirty owner checkout: branch `fix/atomic-study-material-saves`, base/HEAD `533a8f50c2d0de74a75f5542022da3182f376ee9`. Fetched current main `f4c4b53f3e71907ee9f46cb2640de46eec90db5d`. All 24 supplied file hashes and sizes match; only scanner, maintained tests, STATUS and implementation note changed since eighth review. Isolated 307-file source snapshot; all 307 owner files remained unchanged afterward. Native source/fixtures and R9 are unchanged. No existing test matrix was running at preflight.

Windows review runtime: Node 24.16.0, SQLite 3.53.0, sql.js 1.14.2, Vitest 4.1.11. These are measured review versions, separate from the handoff's reported Node 22.14.0/Rust 1.85.0 tools.

| Subset | Independent result |
| --- | --- |
| Maintained six files | 656 passed: driver 605, contract 1, repository 25, form 12, integration 3, editor safety 10 |
| Third through eighth diagnostics | 12 + 14 + 72 + 152 + 68 + 72 = 390 passed |
| Shared prepared package | 181 passed; all 57 conditional seams reached |
| All accumulated focused checks | **1,227 passed**, including every previous failure and 120 new maintained tests |
| New ninth diagnostic | 78 cases: eight passing controls; 64 guard failures, four valid-SQL false rejections, two actual write-loss failures |
| Combined | **1,235 passed / 70 failed**, 14 files, no skips, exit 1, 10.05 s |

[Exact command, sanitized stdout, diagnostic and matched source manifest](evidence/a2-ninth-review-2026-10-04/README.md). The handoff reports all nine sequential full-gate steps passed, frontend 1,218 passed/four skipped and Rust 283 passed/six ignored. Raw current full-gate logs were not supplied. The referenced scratch directory contains an older 17-case material-save failure log, not this gate's output. Those full-gate claims remain reported evidence; the table above is independently verified. Several handoff per-file focused counts were assigned to the wrong file names; the receipt records counts derived from the actual independent log. No full/native matrix was repeated after the focused blocker.

## R13 — P2: carriage return inside a line comment escapes the scanner's comment state

Current locations: `src/data/connectionOwner.ts:123`–128 and `:445`–450 (normal token loop and CREATE/TRIGGER lookahead). Both loops terminate a `--` comment on either LF or CR. Both real engines used here keep CR inside the comment and end the comment at LF (or SQL input end). Ordinary CRLF still works; the defect needs text between a CR and the eventual LF, or a bare CR before input end.

The byte sequence below uses actual CR and LF, represented as escapes:

`--\rignored\nBEGIN;`

SQLite sees an ignored comment followed by a real BEGIN. The scanner exits its comment at CR, scans `ignored` as the first statement token and sets `atStatementStart = false`, then misses the actual BEGIN after LF. With `--\rCASE\n`, it also creates a phantom CASE depth. This affects both public execute/select routes. The eighth correction did not introduce this loop; independent review uncovered a remaining token-boundary defect.

### Actual acknowledged-write loss

The diagnostic reproduces the same sequence on both public drivers with synthetic data:

1. Create `probe(value TEXT)` normally.
2. Call `select('--\rignored\nBEGIN;')`. Expected owner-guard refusal; current code resolves and opens a real transaction.
3. Execute `INSERT INTO probe VALUES ('acknowledged')`; it resolves successfully.
4. Query a deliberately missing table; failure recovery rolls back the open transaction. In sql.js, write-time export already rolls it back.
5. Query `probe`: the acknowledged row is absent, rather than preserved.

This is independently demonstrated development/browser-driver write loss, not merely a trailing-statement acceptance issue. Node's test driver loses the row during rollback recovery; sql.js's acknowledged write is lost during export/reopen. Desktop Tauri does not use this scanner and pins its native atomic operations separately. No installed Mac/Windows or native desktop loss, PDF exploit or real user-data incident is demonstrated.

### Other manifestations and test scope

- Two comment prefixes × eight established suffixes × two public routes × two engines = **64 owner-guard failures**. Some commands resolve; others reach SQLite and throw a different error instead of being refused by the owner.
- Valid `--\rBEGIN;\nSELECT 7 AS value` is wrongly rejected on both drivers because commented BEGIN becomes executable scanner text.
- Valid `CREATE --\rignored\nTRIGGER ... BEGIN ... END;` is accepted and fires in both raw engines, but wrongly rejected by both public drivers because CREATE lookahead leaves the comment too early. These are **four false rejections** together.
- Six raw transaction/trigger legality controls and two valid public CASE-comment controls pass. No raw handle is exposed by production code; the diagnostic accesses raw engines only for its oracle.

## Publication validation

Ten review/index/evidence files pass the link, JSON, credential/conflict-marker and whitespace checks: 227 relative links resolve and two JSON files parse. The unchanged-source release-safety suite passes 51 tests with one intentional skip (4.36 s). These checks validate the documentation publication, not the failing A2 source.

## Follow-up and unchanged holds

Use [the bounded line-comment correction prompt](GEMINI_A2_LINE_COMMENT_CORRECTION_PROMPT_2026-10-04.md). Correct the shared lexical rule in normal scanning and lookahead; retain all previous 1,227 passing focused checks. Add engine-oracle controls for LF, CRLF, embedded CR, bare CR/input end and opaque block/quoted tokens. Keep native saves, cleanup, ownership/recovery, backup integrity, shipped migrations and newer main/Mac/Slice A/Claude setup work. Source remains uncommitted/unaccepted. Actual Mac A2, Slice B and release holds remain unchanged.
