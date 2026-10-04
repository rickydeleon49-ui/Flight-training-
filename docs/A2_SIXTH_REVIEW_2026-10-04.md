# A2 sixth independent review — 4 October 2026

**Decision: the submitted header-consumption correction passes; request one complete-token scanner correction (R10). Do not integrate production source yet.**

## Identity and measured evidence

Windows owner: `fix/atomic-study-material-saves`, base/HEAD `533a8f50c2d0de74a75f5542022da3182f376ee9`, local/uncommitted. Main inspected: `9fa9b277363ef3d1f2f52fd256cb4afe4ad456c3`. All **24/24 submitted hashes matched**. Only four files changed since the fifth review: `connectionOwner.ts`, its driver tests, STATUS and the implementation note. Native code/fixtures and the successful R9 correction are unchanged.

Independent synthetic Windows tests, Node 24.16.0 / Node SQLite 3.53.0 / sql.js 1.14.2 / Vitest 4.1.11:

| Subset in one focused run | Result |
| --- | --- |
| Six maintained frontend files, including expanded 227-case driver suite | **278 passed** |
| Third/fourth/fifth reviewer diagnostics | **12 + 14 + 72 passed** |
| Shared prepared package | **181 passed**, all 57 conditional seams reached |
| Submitted combined focused subset | **557 passed**, matching the handoff |
| New raw/public whole-identifier legality/firing controls | **16 passed** |
| New trigger-suffix refusal combinations | **128 failed** |
| New ordinary-SELECT refusal cases | **Eight failed** |
| Combined | **573 passed, 136 failed**, eleven files, no skips, exit 1, 5.70 s |

[Sanitized log, exact command, diagnostic and submitted hashes](evidence/a2-sixth-review-2026-10-04/README.md). All 307 owner files remained unchanged after review. The full local gate supplied in prose is implementer-reported evidence; no raw full-matrix logs were supplied in this handoff. Codex did not repeat full/native checks after reproducing the new focused blocker. No current-main integration or physical Mac/installed test was attempted.

## Submitted correction outcome

The latest change consumes the expected header table token before keyword interpretation, including SQLite's single-quoted table form. All 64 former refusal failures now pass. Maintained expanded negative cases, side-effect/recovery checks and all prior reviewer cases pass. No further change is assigned to that specific correction or to R9.

## R10 — P2: ASCII fragments of whole identifiers mutate CASE state

Location: `src/data/connectionOwner.ts:187`–197 (word boundary), with CASE state changes in header/body/top-level branches. The word scanner consumes only `[a-zA-Z0-9_]`, while SQLite accepts additional characters inside an unquoted identifier. Thus `case$bucket`, `écase`, `caseé` and `✈case` become a standalone `CASE` fragment to this scanner.

Both real engines and both public drivers legally create and fire each of these triggers, substituting each identifier for the target table:

```sql
CREATE TRIGGER ordinary AFTER INSERT ON source
BEGIN INSERT INTO case$bucket VALUES ('kept'); END;
```

The false CASE fragment increments `caseDepth`. The real trigger END decrements that depth rather than ending the trigger. Append BEGIN, BEGIN TRANSACTION, COMMIT, END, SAVEPOINT, ROLLBACK, ROLLBACK TO or RELEASE: both execute/select routes resolve rather than refuse. Four names × eight suffixes × two routes × two engines = **128 failing combinations of the same lexical defect**.

This is also reproducible without triggers: a plain SELECT from any of those four tables succeeds, and `SELECT value FROM case$bucket; BEGIN;` is incorrectly accepted on both public select routes. A phantom CASE depth survives to the next statement. Those **eight additional failures** rule out a fix limited to trigger examples.

SQLite's [draft tokenizer requirements](https://www.sqlite.org/draft/tokenreq.html) describe longest-token consumption, non-ASCII identifier characters and interior dollar signs. That document is supplementary rationale; the authoritative evidence here is the legality and refusal reproduction on the two actual shipped/test engines. The fix must recognize structural keywords only as complete tokens, preserving valid identifiers and genuine CASE expressions.

**Impact limit:** this is a browser/test-driver guard-contract regression. Their prepared methods generally execute only the first statement; the review does not establish execution of appended controls, lost acknowledged records, native desktop exposure or exploitation by uploaded material. Do not inflate 136 combinations into separate vulnerabilities or claim the desktop app lost data.

## Bounded next action

Documentation publication checks passed: 215 relative links resolve across ten touched/evidence files; two JSON receipts parse; credential/conflict-marker, local-path and whitespace scans are clean. The unchanged-source release-safety suite passed 51 tests with one intentional skip (3.13 s). These checks validate this documentation publication, not acceptance of the failing implementation.

Use the [whole-token Windows hardening prompt](GEMINI_A2_WHOLE_TOKEN_CORRECTION_PROMPT_2026-10-04.md). It asks for a bounded lexical correction with engine-based differential tests across trigger and ordinary SQL, rather than more keyword-specific special cases. Source remains local/uncommitted/unaccepted; all accepted Mac preparation and previous corrections are preserved. Actual Mac A2 execution, Slice B prerequisites and Windows/frozen-Mac release holds remain gated. No version, installer, dependency, migration, signing, tag or release action is assigned.
