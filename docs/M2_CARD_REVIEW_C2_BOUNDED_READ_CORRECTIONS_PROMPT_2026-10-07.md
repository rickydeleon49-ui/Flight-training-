# M2 Card Reviews C2 — Finish bounded reads and cursor contracts (7 October 2026)

You are the implementation model for this assignment. Finish the confirmed remaining planning defects in one coherent package, preserve passing work and hand back precise evidence for independent review. Read [the current review](M2_CARD_REVIEW_C2_PIPELINE_REVIEW_2026-10-07.md) first. This assignment is model-neutral.

## Starting state and authorized scope

Use `/Users/rickymac/code/Flight-training-pr70-integration`, existing dirty branch `codex/m2-card-review-c2-scope`, HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`. Fetch `origin` and read new review documents using `git show origin/main:<path>`; do not pull/reset/stash/switch/rebase/apply main files over this dirty checkout. Before editing, verify all **38 paths** in `origin/main:docs/evidence/m2-card-review-c2-pipeline-review-2026-10-07/submitted-source-hashes.json`. This manifest is a bare path-to-SHA256 object. Report mismatches/competing edits before touching affected files; preserve legitimate completed work.

All five submitted evidence packs must remain byte-identical:
- `m2-card-review-c2-scope-2026-10-07/`
- `m2-card-review-c2-scope-corrections-2026-10-07/`
- `m2-card-review-c2-scope-completion-2026-10-07/`
- `m2-card-review-c2-final-corrections-2026-10-07/`
- `m2-card-review-c2-read-pipeline-corrections-2026-10-07/`

Create the next pack at `docs/evidence/m2-card-review-c2-bounded-read-corrections-2026-10-07/`. Copy and improve the last proof there, preserving repository-relative production imports. Update the live scope, conditional implementation prompt, STATUS and handoff at completion. C2-D1–D9 remain **proposed**, C1 stays accepted, and the previous check-in waiver persists. This is planning/proof work: production C2, additional migrations/indexes/dependencies, native/app launches, installed testing, providers, signing/release and mobile work are not part of it. Leave the implementation uncommitted for the reviewer.

## Preserve the verified fixes

Keep all **48** earlier frozen cases passing, the submitted **32** proof cases, current-version derivation/C1 limits and scheduling parity, historical event identity/provenance/upgrade/reopen, filters and urgency ordering, pending consumption without duplication, authoritative reset replacement, synchronous owned invocation, Retry without replaying writes and the genuine held-A/held-B mutation fixture. Avoid rebuilding the controller or altering accepted production helpers. The four-mutant verifier and survival control now work; preserve them.

## 1. C2-R4: bound all actual work before reads, not emitted rows

The new frozen resource cases demonstrate:
1. Four malformed 700,000-byte discovery payloads read 2,800,000 bytes under a 2,097,152-byte request. Admission depends on `admittedCandidates.length`, so an invalid prefix never activates the guard.
2. The same mutation to four pending IDs reads 2,800,000 bytes while reporting zero. Pending guards depend on `page.length`, and malformed cases continue before accounting.
3. At a 500-card budget, two 500-card sets are transferred/parsed before the second is refused. Actual bytes 48,562; reported 24,281. The already-read candidate is hidden from counters.
4. History enrichment reads two max-ASCII 500-card sets (3,041,002 bytes), ignoring an explicitly requested 2-MiB budget.

Build one consistent admission/accounting policy, applied to initial discovery, pending revalidation and history current-content enrichment:
- Count read attempts/bytes, parsed cards, derivations/hashes, evaluated/scanned candidates and returned rows separately. Count malformed, empty and non-actionable work; invalid or filtered rows are not free. Counters must match instrumented SQLite results and actual executed work, including the candidate at a budget boundary.
- Use bounded metadata/preflight and conservative admission where exact card counts are unavailable. You may reserve the C1 maximum 500 cards before parsing, or demonstrate an equally safe bounded read-only approach. Do not read/parse an extra candidate and pretend it never happened. Validate finite integer options and document hard bounds; `Infinity`, fractions, NaN and negative values must not remove limits.
- At a normal-budget stop, retain every unvisited candidate. Progress cannot depend on whether a visible row has been emitted. A malformed/ineligible prefix can return an incomplete empty page with continuation, never a false terminal “caught up.” Prove full traversal and equality of expected IDs after resource stops, pending deletion/content changes and page-size changes.
- Define an **absolute bounded single-set policy**. Existing code admits any first stored string size. A parsed 500-card limit cannot bound raw JSON with arbitrary whitespace/invalid text/extra data. Choose a documented maximum raw size plus a typed discoverable oversize/deferred result/link and terminating cursor, or a demonstrably bounded single-set lane. Count the exception explicitly, admit at most its bounded unit, and stop. Do not silently drop an eligible material or repeat an empty page forever. Preserve C1's 500 cards, 1000 front/2000 back code points, sourcePage and Unicode rules.
- Give history applicable resource inputs/defaults/counters and an explicit policy. Preflight distinct current sets, avoid transferring all raw sets up front, and preserve keyset event completeness and correct provenance. If enrichment cannot be finished within a call, retain bounded work and an honest pending/deferred state; do not label unknown content “Earlier version” or “current” without proof. The new two-set history test explicitly requests 2 MiB and must pass. Promote traversal tests showing every event appears once despite enrichment stops.
- State IPC result, retained-list and cursor bounds. Extra measured metadata queries are acceptable. A small bounded per-set read design can be justified; if keeping it, stop calling it one batched raw query. Re-audit actual SQL calls/rows/bytes after changes.

Add permanent assertions for malformed/all-ineligible prefixes, failed parses, already-read boundary work, pending budgets, valid max-ASCII/Unicode sets, the chosen absolute oversize policy, all-new/all-due streams, termination and no duplicate/lost identities. Use small fixtures; no giant worst-case allocation.

## 2. C2-R8: make generated cursors consumable and schemas strict

The maximum supported page creates 249 pending ordinary UUID IDs. With 250 candidates and `limit: 1`, issued cursor length is **13,296**, but the decoder rejects anything over **8,192**. Repair encode/decode bounds coherently. A justified bounded cap increase is acceptable if derived from actual maximum counts/ID lengths; a compact bounded representation is also acceptable. Never lose pending IDs to make the token fit. Test maximum-size full traversal with independently expected IDs and varying page sizes, and rejection beyond supported bounds.

Require `v === 1` exactly; remove the `undefined` compatibility escape unless a real approved migration is specified (none exists for this planning token). Validate all due/history key fields, ID types/counts/lengths/uniqueness, exhaustion boolean, context shape, supported filter values and canonical clocks. An owned history token with no `t/id` currently silently restarts page 1. Reject missing/partial/wrong-type keys, arrays in place of objects, malformed/wrong-kind/oversized tokens and wrong ownership **before SQL**, with explicit `INVALID_CURSOR` / `STALE_CURSOR`. Keep valid page-size changes and clock/filter ownership behavior.

Promote all three new cursor behaviors and extend them with corrupt key fields and oversize decoded content; merely checking ctx or input string length is insufficient. Test generated output against the same strict decoder.

## 3. Finish previously requested supporting contracts

- Replace the false 31.25-MB worst-case statement: `250 bytes/card` is a small-text example. Show honest code-point/UTF-8/JSON-escaping arithmetic and explicitly label unmeasured cases. Raw JSON may contain additional whitespace, so a serialization estimate is not a storage cap. Use at least one genuinely 500-card/1000-front/2000-back Unicode fixture and assert it is production-valid before measurement.
- Component timing currently duplicates the pipeline and ignores the length metadata it collects. Instrument the final reader, or remove/label the duplicate measurements as approximate. Preserve legitimate full-call measurements with fixture/toolchain labels. Do not claim desktop IPC/WebKit performance; those remain unmeasured. Avoid a redundant full native or application gate.
- Complete the typed frozen inspection/state contract. Validate parsed legacy prior/next JSON before adopting it as a schedule: object/null shape, finite allowed integer steps, valid date strings, and appropriate optional count fields/scheduler version. Malformed/unsupported state must yield typed nullable display fields, not invented intervals. Include an explicit nullable interval value/label derived from validated C1 semantics, preserving raw historical audit data without rewriting it. Add valid, absent, malformed, out-of-range, wrong-type and unsupported-version cases. Keep event/material/version/item identity and read-only inspection stable across live content changes.
- Align scope and conditional prompt with final APIs, counters, cursor bounds/schema, history enrichment and oversize policy. Replace `file://` links with repository-relative links. Keep the owner approval gate and no-additional-C2-migration statement; schema-11 upgrade still runs shipped 0012.

## Verification and handoff

Read the current review's frozen test from `origin/main:docs/evidence/m2-card-review-c2-pipeline-review-2026-10-07/diagnostic.test.mjs`; copy it without editing over dirty files. First reproduce the submitted source result: **1 control pass / 7 assertion failures**, exit 1. Run from repository root, using:

```sh
C2_REVIEW_MODEL=/absolute/path/to/new/proof/contractModel.mjs \
  /opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test <frozen-test-path>
```

Run all five frozen files unchanged with the new target:
1. `m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs` — 9.
2. `m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs` — 12.
3. `m2-card-review-c2-completion-review-2026-10-07/diagnostic.test.mjs` — 16.
4. `m2-card-review-c2-final-review-2026-10-07/diagnostic.test.mjs` — 11.
5. `m2-card-review-c2-pipeline-review-2026-10-07/diagnostic.test.mjs` — 8, including its control.

These are under `docs/evidence/`. Preserve origin hashes and relative import locations. Expected final total: **56 passes**, zero failures. Do not weaken diagnostics, suppress failures or relabel emitted-row counts as actual work. Show meaningful failure-before/pass-after for new permanent cases. Run the focused proof, mutation verifier and survival control, real query/work accounting and representative benchmark only. Document commands, working directory, Node flags, actual exits/stdout/stderr; tools that write receipts must write to the new pack.

Provide report/README/results with issue-to-fix and exact test mapping, immutable raw receipts, source-hashes manifest for all delivery/proof files, and SHA256SUMS excluding itself. Verify both before handoff. Include prior evidence preservation, production helpers/migrations unchanged, the supported maximum cursor/oversize policies, honest limitations and precise checkout/staging/commit state. Update STATUS/handoff to “corrected, pending independent review,” not accepted. Stop for review; no new owner gate or roadmap work needs to be invented.
