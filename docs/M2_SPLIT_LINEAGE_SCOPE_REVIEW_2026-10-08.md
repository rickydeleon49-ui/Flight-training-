# M2 split-source lineage — independent scope review (8 October 2026)

**Decision: changes requested before scope acceptance or owner-default approval.** This is a planning/proof review; no production migration or feature is activated. C2 source acceptance (PR #122) remains intact.

Submitted checkout: `/Users/rickymac/code/Flight-training-split-lineage-scope`, branch `codex/m2-split-lineage-scope`, base/HEAD `11fb3ad12abb2f797ee4e9bb2171ce983d22a88e`. Six document/source hashes and nine evidence checksums independently verify before/after review. Original scope checkout and the older dirty clones were not edited. Independent execution used an isolated reviewer checkout.

## SL-R1 — P2: source-version and nested navigation contract is incomplete

The defaults propose hashing the **immediate parent PDF** during splitting, while the stored range is relative to the **original root**. One `source_content_sha256`/`source_total_pages`/`source_title` tuple cannot silently alternate between those two meanings. Example: root R has 400 pages; part A covers R pages 101–300 and has 200 pages; splitting A pages 20–40 gives R pages 120–140. The A bytes/hash/200-page total are not the R bytes/hash/400-page total. The scope's `rootTotalPages = rootEnd - rootStart + 1` is actually the grandchild length (21), not R's total.

The UI proposes a parent link to A while displaying/copying page 120, which is a root coordinate; opening A requires page 20. The proof composes arithmetic but never persists this nested identity or verifies navigation targets.

Replacement is also not classified: `getMaterialWithLineage` returns `parentStatus: available` for a live material even after its path changes. Test 8 manually compares two locally computed hashes; the read service never obtains/compares a current source hash. Siblings are grouped by parent material ID only, mixing parts from different editions of that material. Original IDs are erased by SET NULL without a separate stable identity snapshot. The scope doesn't choose which relationships/navigation should survive that loss.

Specify an immutable root-source identity/version snapshot, immediate-parent identity/version, clearly named page coordinates and totals, and a read-only navigation verdict (matching, changed, missing, unknown). Define how the native split result ties hash/ranges to the exact bytes split and how the save rejects a stale/deleted/replaced parent in its pinned transaction; keep material/tag/lineage writes atomic and define output-file cleanup versus acknowledged save/refresh failure. A field layout is a proposed owner choice, not a production change. Remove unmeasured “30–50 ms/negligible” hashing and “90%+” prevalence claims. Prove nested persisted lineage, replacement classification and edition-correct siblings using the exported model, rather than two independent hash values.

## SL-R2 — P2: range and schema invariants are not enforced at the public boundary

`proof/lineageContract.mjs:63–70` receives only a child page and source start. It returns 301 for child page 201 of a child covering 101–300 (only 200 pages). The promised upper bound is unavailable to the helper. Add the recorded source end/child length, enforce one-based finite safe integer bounds, and reject positions outside the child.

The proposed INTEGER columns use SQLite affinity without integer checks. Actual inserts accept `source_page_start=101.5`, and TEXT PRIMARY KEY permits `material_id=NULL` without a child foreign-key target. A child can be its own `root_material_id`. Five frozen diagnostics include these actual admissions and the baseline-schema mismatch below. Enforce the chosen identities, range types/order/totals, root-versus-child distinction and nested consistency at the schema/helper boundary, including update paths where appropriate. Preserve valid unknown-root/legacy states without inventing provenance. Use one candidate DDL source and run tests against it; candidate SQL and the helper currently duplicate DDL.

## SL-R3 — P2: evidence claims exceed the executed proof

`createDisposableLineageDb` is labelled “schemas 0001 through 0012” but manually creates an abbreviated, different schema and inserts migration numbers. It invents `practice_sessions` and `card_review_states`; accepted migrations actually contain `practice_attempts` and `card_review_state` with version/item/event/projection constraints. It is not a shipped-schema upgrade/history-preservation proof.

Test 13 performs a numeric comparison in `simulateOlderBinaryRestore`; it never exports/reopens a populated database or runs backup validation. Test 12 re-hashes the same untouched in-memory Buffer, and it checks invented history rows rather than accepted attempt/card snapshots. Treat the numeric test as a simulation only; reuse cited accepted native restore checks for unchanged behavior and add a disposable actual-schema migration/export/reopen proof. Do not claim a future schema-13 binary has been tested.

The negative-control script creates separate hard-coded faulty functions/tables and does not mutate the exported implementation. In an isolated scratch copy, changing the exported `composeNestedRanges` start formula to omit `-1` leaves the script at **exit 0 / 4-of-4 success**, while the actual proof suite fails (exit 1). The normal suite has meaningful arithmetic assertions; the claimed mutation evidence is not tied to it. Mutate the real exported helper/candidate DDL in scratch copies and require the actual targeted assertions to fail, followed by exact restoration. Prefer a few genuine checks over a larger campaign. Record raw exits and identify simulated/unmeasured boundaries honestly.

## Verification and preservation

| Independent check | Result |
| --- | --- |
| Submitted document/source hashes | 6/6 match, before/after |
| Submitted evidence checksums | 9/9 match |
| Submitted proof | 13 tests passed, exit 0 (node:test reports 0 suites) |
| Submitted negative controls | exit 0, prints 4/4; evidentiary limitation described above |
| Frozen reviewer diagnostics | 2 controls pass / 5 assertions fail, exit 1 |
| Exported arithmetic mutant | actual proof exits 1; supplied negative-controls script falsely stays exit 0 |

Application source, dependencies, shipped migrations and accepted C2 evidence are unchanged. No full application test matrix was run for this docs/disposable-proof task. No installed-app, provider, signing or release work occurred.

Published artifacts include the submitted scope/evidence, frozen diagnostics, raw independent receipts and submitted live-document snapshots. The original scope proposal remains available as a pending proposal, not accepted implementation authority. Continue with [one focused correction assignment](M2_SPLIT_LINEAGE_SCOPE_CORRECTIONS_PROMPT_2026-10-08.md). Owner SL-D1–D8 choices remain proposed; do not seek production activation until this contract is reviewable.
