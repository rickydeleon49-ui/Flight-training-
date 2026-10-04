# A2 eighth independent review — 4 October 2026

**Decision: the submitted leading-BOM and complete-variable corrections pass their previous reproductions. Two remaining trigger-boundary defects block source integration.**

## Identity and evidence

The user requested a review of the latest local work without a new pasted handoff. Codex read actual current source and implementation notes. Owner branch/base remains `fix/atomic-study-material-saves` / `533a8f50c2d0de74a75f5542022da3182f376ee9`, dirty and uncommitted. Current main inspected: `e203a039ec449121f6b8e6677578197c25369a90` (includes the separately merged Claude setup PR #70); its newer instructions/source are preserved.

Codex computed the 24-file current source manifest and a 307-file isolated snapshot. These are observed hashes, not a claim that a new implementer-supplied manifest matched. Exactly four owner files changed since seventh review: scanner, driver tests, STATUS and implementation note. All 307 owner files remained unchanged after review. Native, fixtures and R9 are unchanged. No test matrix was running in the owner checkout at preflight.

Windows synthetic-source tests: Node 24.16.0 / SQLite 3.53.0 / sql.js 1.14.2 / Vitest 4.1.11.

| Subset | Independent result |
| --- | --- |
| Maintained six files | 536 passed: drivers485, contract1, repository25, form12, integration3, editor safety10 |
| Third through seventh reviewer diagnostics | 12 + 14 + 72 + 152 + 68 = 318 passed |
| Shared prepared package | 181 passed, all 57 conditional seams reached |
| Previously reported focused total | **1,035 passed** |
| New eighth diagnostic | Eight raw/public legality/firing controls pass; 64 trailing-refusal combinations fail |
| Combined | **1,043 passed / 64 failed**, 13 files, no skips, exit 1, 15.50 s |

[Diagnostic, exact command, sanitized output and observed hashes](evidence/a2-eighth-review-2026-10-04/README.md). The previous direct-BOM actual write-loss regression now passes; complete variable token cases and R9 also pass. No raw current full-matrix logs were supplied; only the local implementation note's focused claims were inspected. Full/native validation was not repeated after blockers. No installer/physical Mac/live API execution or current-main source integration occurred.

## R12 — P2: an expression decimal point leaks table-name expectation

Location: `src/data/connectionOwner.ts:141`–147 and 319–336. Every dot seen in a trigger header sets `expectingTableName = true`, even after the ON target has already been consumed. A valid leading decimal `.5` in WHEN goes through that dot branch, then the numeric branch, leaving the table expectation set. The next real body BEGIN is consumed as the supposedly expected table name. The scanner remains in header state and ignores transaction commands appended after the complete trigger.

Both actual engines and both public drivers accept and fire:

```sql
CREATE TRIGGER probe AFTER INSERT ON source
WHEN .5 BEGIN INSERT INTO target VALUES ('kept'); END;
```

Four positive controls pass. Appending the eight established transaction suffixes on both execute/select routes and engines incorrectly resolves instead of refusing (**32 failures**). Negative tests require refusal before creating the trigger. Do not fix this by rejecting valid decimal expressions, dropping qualification support or merely recognizing the particular literal 0.5.

## R11 — P2 remains at token boundaries inside a trigger header

Location: `src/data/connectionOwner.ts:106`–109. The correction skips U+FEFF only while `atStatementStart` is true. That is too narrow: a BOM beginning a token before the body BEGIN is accepted as a separator by both engines, even though the scanner is still within the header. The scanner instead consumes BOM + BEGIN as a non-keyword identifier and never enters the body.

Both engines and public drivers accept and fire:

```text
CREATE TRIGGER probe AFTER INSERT ON source <U+FEFF>BEGIN
INSERT INTO target VALUES ('kept'); END;
```

Four positive controls pass. The same eight suffixes, two routes and two engines give **32 refusal failures**. The submitted direct statement-start BOM correction stays correct; these failures concern an additional token-boundary position. Keep BOM inside a quoted value or an already-started identifier intact, and retain unsupported BEGIN-followed-by-BOM controls. Do not globally delete U+FEFF from SQL.

**Impact scope for both:** browser/test-driver guard contract; their prepared methods generally execute only the first SQL statement. This review proves trigger creation is accepted when the whole request should be refused, but does not prove execution of appended transactions, new acknowledged-row loss or native desktop exposure. Earlier direct-BOM loss is historical and its reproductions now pass.

## Publication validation

Ten touched/evidence files pass link, JSON, credential/conflict-marker, sanitized-path and whitespace checks: 222 relative links resolve and two JSON receipts parse. The unchanged-source release-safety suite passes 51 tests with one intentional skip (4.07 s). This validates the review publication, not the failing source.

## Bounded follow-up

Use [the trigger token/role correction prompt](GEMINI_A2_TRIGGER_TOKEN_ROLE_CORRECTION_PROMPT_2026-10-04.md). It assigns lexical-boundary/role consistency and a deterministic engine-based table of relevant expressions; it does not ask for a general SQL parser or native rewrite. Preserve all previous passing assertions, native saves, cleanup, ownership, backup integrity, migrations and newer main/Claude/Mac/Slice A work. Source remains local/uncommitted/unaccepted. Actual Mac A2, Slice B and release gates remain held.
