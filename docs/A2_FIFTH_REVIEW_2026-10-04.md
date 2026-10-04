# A2 fifth independent review — 4 October 2026

**Decision: request one bounded R8 correction. R9's submitted title-preservation correction passes. Do not integrate the production implementation yet.**

## Identity and measured results

The Windows owner still holds `fix/atomic-study-material-saves`, base/HEAD `533a8f50c2d0de74a75f5542022da3182f376ee9`, uncommitted. Shared main inspected: `b6951310d31b1f763b7116572c9f46857f08c800`. All **24/24 submitted hashes matched**. An isolated 307-file snapshot shows only five files changed since the fourth review: the scanner, material transaction helper, driver tests, implementation note and STATUS. Native source/tests/fixtures are unchanged.

Independent Windows execution, synthetic data only, Node 24.16.0 / Vitest 4.1.11 / Node SQLite 3.53.0 / sql.js 1.14.2:

| Subset in one focused run | Result |
| --- | --- |
| Six maintained frontend files, including the expanded 89-case driver file | **140 passed** |
| Third-review diagnostics | **12 passed** |
| Fourth-review diagnostics | **14 passed** |
| Shared prepared diagnostic package | **181 passed**, all 57 conditional seams reached |
| New raw-engine and public-driver legality/firing controls | **Eight passed** |
| New trailing-transaction refusal cases | **64 failed** |
| Combined | **355 passed, 64 failed**, ten files, no skips, exit 1, 5.40 s |

[Shared diagnostic, sanitized log and identity receipts](evidence/a2-fifth-review-2026-10-04/README.md). The 64 failures are combinations of one defect, not 64 independent bugs: two table spellings × eight suffixes × two routes × two engines. The implementer's full frontend/build/Rust/lockfile gate is reported evidence; Codex did not repeat that expensive matrix after reproducing the blocker. No physical Mac, APFS, installed or live-provider result is claimed.

## Remaining R8 — P2: header table token is not consumed, so trailing control escapes refusal

Locations: `src/data/connectionOwner.ts:101`–118 (single-quoted token) and `:193`–209 (header keyword/table state).

Both engines legally create and fire:

```sql
CREATE TRIGGER ordinary AFTER INSERT ON end
BEGIN INSERT INTO observed VALUES ('kept'); END;

CREATE TRIGGER ordinary AFTER INSERT ON 'end'
BEGIN INSERT INTO observed VALUES ('kept'); END;
```

Each diagnostic uses fresh `end` and `observed` tables. Both raw engines and public drivers accept and fire each trigger: eight positive controls pass. However, append any of `BEGIN;`, `BEGIN TRANSACTION;`, `COMMIT;`, `END;`, `SAVEPOINT sp1;`, `ROLLBACK;`, `ROLLBACK TO sp1;` or `RELEASE sp1;`. Every public `execute` and `select` call resolves instead of returning the required atomic-operations refusal: 64 failures.

Root cause: after `ON`, `expectingTableName` is true. An unquoted `END` reaches the keyword branch before the table-token branch, leaving that expectation set. A single-quoted table spelling also leaves it set. The actual `BEGIN` is then consumed as the expected name rather than entering the body. `triggerState` remains `header` through the outer terminator and appended statement, bypassing the top-level guard.

The submitted negative tests cover a trigger **named** `end` attached to ordinary `source`; they do not combine the other accepted table-name variants with those same negative suffixes. Positive compatibility and negative refusal must be tested together.

**Impact limit:** this proves an enforcement-contract regression in browser/test drivers. Their prepared single-statement execution generally ignores the appended statement; this review does **not** demonstrate execution of that suffix, lost acknowledged data, a native desktop bypass or exploitation from user material. Preserve the refusal invariant before accepting the source.

Required correction: consume an identifier according to its header role before interpreting its spelling as a keyword. Handle SQLite's engine-proven single-quoted name in that role without reinterpreting ordinary string literals elsewhere. Properly finish the definition and inspect trailing statements. Do not disable the guard, require callers to quote otherwise valid names, hard-code these examples or expand into a new parser dependency.

## R9 outcome

The updated helper trims/validates only supplied titles and preserves omitted stored titles. All prior reviewer reproductions and maintained padded/whitespace-only title, status/tag-only, explicit trim and explicit blank rejection cases pass. No additional R9 correction is assigned. Preserve unfamiliar stored enum values, empty optional text, omission/null distinctions, tags, rollback and browser reopen durability.

## Next action and platform limits

Documentation publication checks passed: 209 relative links resolve across ten touched/evidence files; two JSON receipts parse; credential/conflict-marker, local-path and whitespace checks are clean. The unchanged-source release-safety suite passed 51 tests with one intentional skip (3.12 s). These checks validate the review publication, not the blocked implementation.

Use the [single-issue Windows correction prompt](GEMINI_A2_TRIGGER_HEADER_CORRECTION_PROMPT_2026-10-04.md). Source remains local/uncommitted/unaccepted. Accepted Mac preparation is preserved; actual Mac A2 execution and Slice B prerequisites remain gated. Keep Windows distribution held on v0.5.1, v0.5.2 retired and the frozen v0.5.3 Mac candidate held. No release, version, installer or signing action is assigned.
