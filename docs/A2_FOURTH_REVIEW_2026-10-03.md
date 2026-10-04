# A2 fourth independent review — 3 October 2026

**Decision: request two narrow follow-up corrections. Do not publish or merge the production implementation yet.** The previous concrete R8/R9 reproductions now pass. This review finds remaining variants of those same contracts, rather than assigning unrelated features.

## Reviewed identity and verification

Repository: `https://github.com/rickydeleon49-ui/Flight-training-`. The existing Windows owner retains the uncommitted `fix/atomic-study-material-saves` tree over `533a8f50c2d0de74a75f5542022da3182f376ee9`. All **24/24 submitted hashes matched**. A new isolated 307-file snapshot was tested; all **307/307 owner files remained unchanged** afterwards. Production native source/fixtures are unchanged from the previous review.

Actual GitHub main and owner `origin/main` were both `fb506ce2fbf4dc64a930aa70e356902812fdf781`. The report's different full SHA beginning `fb506ce9...` is an inaccurate identity receipt; correct it in the next handoff. It did not prevent source hash verification.

Independent execution on Windows (Node 24.16.0, Node SQLite 3.53.0, sql.js 1.14.2, Vitest 4.1.11), synthetic data only:

| Subset in one sequential focused run | Result |
| --- | --- |
| Six maintained A2 frontend files | **92 passed** |
| Third-review diagnostic package | **12 passed** (all previous R8/R9 cases) |
| Shared Mac-preparation package | **181 passed**, all 57 conditional seams reached |
| New raw-engine trigger legality/firing controls | **Six passed** |
| New public-driver trigger identifier cases | **Six failed** |
| New notes-only / omitted-title cases | **Two failed** |
| Combined result | **291 passed, eight failed**, nine files, exit 1, 5.69 s, no skips |

The full build/Rust matrix reported by the implementer is retained as reported evidence. Codex did not repeat that matrix after the new focused failures were established. These are real engine/source tests on Windows, not Mac execution or installed-app evidence. [Sanitized log, diagnostic and hash receipts](evidence/a2-fourth-review-2026-10-03/README.md).

## R8 remains P2 — END used as an identifier still closes trigger context

Location: `src/data/connectionOwner.ts:166`–177. `caseDepth` correctly fixes CASE expressions, but any other unquoted token spelled `END` at depth zero still clears `inTrigger`, regardless of its grammatical role.

Both real engines accept and fire these valid triggers:

```sql
CREATE TRIGGER end AFTER INSERT ON source
BEGIN INSERT INTO observed VALUES ('kept'); END;

CREATE TRIGGER ordinary AFTER INSERT ON end
BEGIN INSERT INTO observed VALUES ('kept'); END;

CREATE TRIGGER ordinary AFTER INSERT ON source
BEGIN INSERT INTO end VALUES ('kept'); END;
```

Each test uses a fresh synthetic database and the required tables; the third example is a separate case from the second. Raw node:sqlite `prepare(...).run()` and sql.js `run(sql, [])` prove legality and trigger effect: six passing controls. The public drivers reject all six definitions with the atomic-operations error, since the identifier prematurely closes scanner state and the actual terminator becomes a supposed transaction statement.

**Required correction:** distinguish the trigger header and top-level body statement boundary from identifier/expression tokens. A genuine outer END terminates the definition; a trigger/table/column identifier must not. Preserve CASE nesting, comments/quotes, multiple body statements and strict refusal of real transaction control after the completed definition. Do not require callers to quote otherwise valid SQL as a workaround, remove the guard or skip all trailing SQL. This remains a development/test-driver compatibility issue; it is not evidence that the native desktop save command lost data.

## R9 remains P2 — omitted title is now trimmed during a notes-only update

Location: `src/data/materialTransaction.ts:246`–249. The correction removed normalization for the other omitted fields, but now selects the stored title and unconditionally calls `.trim()` on it. The prior implementation trimmed only a supplied title. This follow-up is a regression introduced by the latest correction.

Reproduction on both public drivers:

1. Create a synthetic material and tag.
2. Store the schema-permitted title `"  Stored title  "` via public SQL, representing a preexisting raw row.
3. Call `saveMaterialAtomically({ mode: 'update', id, fields: { notes: 'Changed note' } })`; omit title and tags.
4. The operation succeeds, but raw title becomes `"Stored title"`.

Both cases fail full raw-column comparison after excluding only requested notes and permitted updated_at. Native `handle_update_material` trims/validates `Some(title)` and preserves `None => cur_title`; inspection confirms the intended distinction, but no new native run is claimed.

**Required correction:** trim and validate a newly supplied title only. When the operation omits title, preserve its raw stored value and allow the unrelated update according to the native contract. Add maintained tests for notes/status/tag-only updates against padded stored titles, and retain explicit blank-title rejection/rollback. Do not weaken the byte-preservation assertion or pre-normalize the fixture to make it pass. Preserve the now-correct unfamiliar enums, empty optional text, null semantics and all rollback/durability behavior.

## Next action and publication limits

Documentation publication checks: all 203 relative links resolve across the ten touched/evidence files, both JSON receipts parse, and the credential/conflict-marker scan found no issues. The focused release-safety suite passed **51 tests with one intentional skip** (3.39 s); the app source and release configuration are unchanged. The publication incorporates main's subsequent roadmap-planning PR #69 without changing that work. These checks validate this documentation publication, not acceptance of the failing A2 implementation.

The [bounded Windows follow-up prompt](GEMINI_A2_FINAL_EDGE_CORRECTIONS_PROMPT_2026-10-03.md) assigns only these two remaining variants, precise tests and factual receipt corrections. The owner implements and returns uncommitted. Codex will review, integrate with current main, validate the resulting tree and coordinate a source PR only after acceptance.

This publication shares documentation/evidence only. The A2 production code remains local and unaccepted, so actual Mac A2 execution and Slice B prerequisites remain gated. Preserve the accepted Mac preparation and all newer main work. Windows distribution stays held on v0.5.1, v0.5.2 retired, frozen v0.5.3 held. No version, installer, signing decision, tag or release artifact changes are assigned.
