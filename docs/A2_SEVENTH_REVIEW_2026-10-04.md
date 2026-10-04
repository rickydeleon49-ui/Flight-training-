# A2 seventh independent review — 4 October 2026

**Decision: the previous complete-identifier correction passes, but R10 parameter interiors and new R11 BOM handling block source integration.**

## Identity and measured evidence

Owner checkout remains Windows-local, uncommitted, branch `fix/atomic-study-material-saves`, HEAD/base `533a8f50c2d0de74a75f5542022da3182f376ee9`. Main inspected: `4772f8b3d52697f94d7dd6f58db2a1f4d690134b`. All 24 submitted hashes match; 307 owner files remain unchanged. Four files differ from the sixth-review snapshot: scanner, maintained driver tests, STATUS and implementation note. Native source/fixtures and R9 are unchanged.

One independent focused Windows run: Node 24.16.0, Node SQLite 3.53.0, sql.js 1.14.2, Vitest 4.1.11. Synthetic data only.

| Subset | Result |
| --- | --- |
| Maintained six files | 442 passed: drivers 391, contract 1, repository 25, form 12, integration 3, editor safety 10 |
| Third/fourth/fifth/sixth diagnostics | 12 + 14 + 72 + 152 passed |
| Shared prepared package | 181 passed; all 57 conditional seams reached |
| Previously reported focused total | **873 passed independently** |
| New seventh diagnostic | 18 passed / 50 failed, 68 total |
| Combined | **891 passed / 50 failed**, 12 files, no skips, exit 1, 7.28 s |

[Exact command, diagnostic, sanitized stdout and hashes](evidence/a2-seventh-review-2026-10-04/README.md). The full final gate (1,004 frontend and 283 Rust tests, etc.) remains implementer-reported: no raw full-gate stdout was supplied despite the previous prompt. No full/native matrix was repeated after reproducing focused blockers. No current-main integration, installer, Mac or live Gemini test occurred.

## R11 — P2: leading BOM permits actual public transactions and lost acknowledged development writes

Location: `src/data/connectionOwner.ts:96`–100, identifier handling at 274–287. The new ASCII-only delimiter branch lets a leading U+FEFF byte-order mark enter the identifier scanner. It consumes BOM + BEGIN as one non-keyword token. Both real engines accept a leading BOM before a genuine BEGIN statement; engine controls prove a write inside it rolls back.

Both public routes on both engines accept `\uFEFFBEGIN;` and `\uFEFFSAVEPOINT bom_probe;` rather than throwing the atomic-operation refusal: **eight failed refusal tests**. Unlike the old trailing-only examples, BEGIN is the first executed statement here and really opens a transaction.

A deterministic follow-up reproduces acknowledged row loss on both development/test drivers:

1. Create a synthetic probe table.
2. Public select executes leading-BOM BEGIN.
3. Public execute inserts a row and resolves successfully.
4. Issue an unrelated missing-table query, then read the probe table.
5. Expected acknowledged row is absent on both drivers (**two failures**).

For node:sqlite, the failure recovery rolls back the still-open transaction, including the acknowledged insert. For sql.js, durable write's export rolls back the externally opened transaction before storing its bytes. This is an actual source-test durability regression, not just a lexical false negative.

**Scope:** P2 because these paths are the plain-browser development database and the Node test driver. Native desktop uses separate atomic Rust commands. No uploaded-file exploit, installed-app or native-desktop loss is demonstrated. Do not generalize this evidence into a claim that users' desktop records were lost.

## R10 — P2 remains for complete Tcl-style variable tokens

Location: `src/data/connectionOwner.ts:225`–233. The new parameter branch stops at the opening parenthesis in legal variables `$value(case)` and `$value::ns(case)`. The interior CASE then changes top-level caseDepth and suppresses trailing control refusal.

Both real engines and both public select routes legally return NULL for these unbound variables: **eight legality controls pass**. SQLite documents namespace separators and a parenthesized suffix in [parameter syntax](https://www.sqlite.org/lang_expr.html#varparam); actual engine tests are the decisive evidence.

For two names × five suffixes (BEGIN, COMMIT, SAVEPOINT, ROLLBACK, RELEASE) × two routes × two engines, **40 refusal combinations fail**. Eight corresponding END suffix cases pass because END first closes the phantom CASE depth. Thus the defect remains even though the earlier dollar/non-ASCII identifier reproductions now all pass.

Prepared routes generally execute only the first statement. No appended transaction execution or row loss was demonstrated for these parameter suffix cases; the stronger loss evidence above belongs specifically to direct BOM transactions.

## Handoff accuracy and missing coverage

The aggregate 873 count is accurate, but the handoff's per-file breakdown is not. The actual maintained counts are 391/1/25/12/3/10, not 391/9/17/10/8/7. The shared contract fixture is one parameterized parity test, not nine separately reported TS tests.

The new tests sanitize the supplied names before using them as trigger/column names, so they do not prove original dollar/non-ASCII forms in those roles. The claimed Unicode-folding control tests a scanner result for ſavepoint, not raw/public legality or the more relevant caſe identifier. The named-parameter checks exercise negative guards without positive real parameter results, omit dollar-parenthesized parameters, and include an unused variable in a trigger test. The prompt below assigns only the missing bounded coverage, preserving passing assertions.

Temporary diagnostic removal left the owner dirty, as expected; the handoff phrase 'working tree completely clean' should instead say task-owned diagnostic copies were removed.

## Publication validation

Documentation checks: 217 relative links resolve across ten touched/evidence files; both JSON receipts parse; credential/conflict/local-path and whitespace scans pass. The unchanged-source release-safety suite passes 51 tests with one intentional skip (3.16 s). These checks validate the review publication, not the failing A2 implementation.

## Next action and preserved gates

Use [the complete-token follow-up prompt](GEMINI_A2_BOM_PARAMETER_CORRECTION_PROMPT_2026-10-04.md). Fix both bounded gaps, prove engine/public legality and pre-effect refusal, supply raw logs, then return uncommitted for independent review. Preserve R1–R9, prior diagnostics and all 57 shared seams. Accepted Mac preparation, current-main work, backup integrity, migrations and platform behavior remain intact. A2 source acceptance, actual Mac A2, Slice B prerequisites and release holds remain uncleared.
