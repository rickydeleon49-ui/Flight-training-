# M2 Card Reviews C2 — Finish the confirmed contracts (7 October 2026)

You are the owner's selected implementation model. Finish the remaining C2 planning corrections in one coherent package. Read [the latest independent review](M2_CARD_REVIEW_C2_BOUNDS_REREVIEW_2026-10-07.md); preserve working fixes and use the exact cases below. This assignment is model-neutral. Prior prompts are historical; this is the active correction assignment.

## Start, preserve and stay within scope

Work in `/Users/rickymac/code/Flight-training-pr70-integration`, existing dirty `codex/m2-card-review-c2-scope`, HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`. Fetch origin; read new review/prompt files through `git show origin/main:<path>`, without applying them over the dirty checkout. Verify all **40** paths in `origin/main:docs/evidence/m2-card-review-c2-bounds-rereview-2026-10-07/submitted-source-hashes.json` before edits. It is a bare path-to-SHA256 map. Report competing mismatches before editing affected work; preserve legitimate progress. Do not reset, pull, stash, rebase or switch this branch.

Preserve all six existing submitted evidence packs byte-for-byte: `m2-card-review-c2-scope`, `scope-corrections`, `scope-completion`, `final-corrections`, `read-pipeline-corrections`, `bounded-read-corrections` (each suffixed `-2026-10-07`, under `docs/evidence/`). Create `docs/evidence/m2-card-review-c2-contract-finish-2026-10-07/` for improved proof, tests and receipts. Copy the latest proof there; keep repository-relative production imports. Update the four live delivery documents at completion: scope, conditional implementation prompt, STATUS and handoff.

Keep C2-D1–D9 **proposed** until independent acceptance and recorded owner approval. C1 acceptance and prior waiver persist. No production C2 code, new migration/index/dependency, provider call, app/native launch, installed test, signing/release or mobile work is part of this assignment. Leave changes uncommitted for independent review.

## Verified work to retain

All **56** earlier frozen diagnostic cases pass, submitted proof **40/40** passes, and baseline/four semantic mutants/survival control work. Preserve the current-version/C1 parity, filters/ranking, A→B→A schedules, historical event identity/reopen/upgrade/provenance, pending-prefix consumption, authoritative reset, synchronous/asynchronous operation ownership and read-only Retry. Keep the new immediate byte accounting and 32-KiB consumable generated cursor. Keep valid raw-audit/nullable inspection fields and the production-valid max-Unicode fixture.

One submitted proof asserts that an oversize set yields zero rows/null cursor. That assertion encodes the defect below. Rewrite it to the corrected explicit oversize contract, naming/disclosing the change; do not preserve a false expectation merely to retain the 40/40 count. All frozen reviewer files stay unchanged.

## 1. C2-R4: explicit oversize outcomes and admission before work

### Oversize source and exact reproduction

In the latest `proof/contractModel.mjs`, initial discovery lines 689–694 mark the oversize candidate processed then break. Pending lines 477–479 consume its ID and break. Neither path emits an error/issue/link. One valid oversize set therefore disappears as “caught up.” The earlier report's claim of throwing `PAYLOAD_TOO_LARGE` is false.

The frozen fixture is 500 cards with `front: '\u0001'.repeat(1000)`, `back: '\u0001'.repeat(2000)`, `sourcePage: null`. `JSON.stringify` produces **9,020,501 bytes**, and the existing C1 parser returns `ok`. Do not change C1 validation to make it invalid. The proposed absolute cap is **8,388,608 bytes**.

Prefer an explicit bounded issue collection on due results, for example `issues: [{materialId, title, code: 'PAYLOAD_TOO_LARGE', rawBytes, allowedBytes, inspectionTarget}]`, with a documented read-only action and no automatic retry loop. Advance past a *reported* deferred identity so later normal materials remain discoverable. Show blocked/deferred work distinctly from actionable rows and caught-up state. Use the same policy during pending revalidation; never consume an identity silently. A typed actionable error is also permitted by the diagnostic, but a whole-page error must not permanently block later materials or create Retry livelock. Choose one coherent policy, not three patches.

History's first distinct set currently bypasses all absolute-size checks (around lines 950–958) and transfers the same **9,020,501 bytes**. Apply the absolute cap before fetching every raw set, regardless of index. For smaller first sets that exceed a normal requested batch budget, document one bounded single-set exception and explicit counters; never admit a second unit under that exception. Preserve correct unknown provenance while deferred, no false current/earlier classification.

### Mixed-size card budget, exact reproduction and recommended repair

Both initial and pending loops read/parse 400-card and 500-card sets under a **600-card** request, then refuse the second only after parsing it. **900 parsed / 400 reported evaluated** is not enforcement.

Move admission before `getSetStmt.get` / `parseSavedCards`. A simple acceptable fix is conservative reservation of the C1 **MAX_CARDS = 500** for each next set when exact count metadata is unavailable. After a first 400-card set under 600, remaining 200 cannot reserve 500: retain the second candidate and stop before transfer/parse. A first set under a smaller-than-500 requested budget may use a clearly bounded one-set exception, then stop. Do not use `page.length` or admitted-row count to decide whether work exists: malformed and non-actionable work also consumes reservations/budgets.

Keep distinct executed counters for metadata candidates, raw reads/bytes, reserved/parsed cards and derived/hashed cards/results. Count actual work independently of returned rows. A malformed parse is bounded by raw-byte and reservation policy, not free. Re-audit counters against instrumented actual reads. Validate input limits and declare normalization/hard bounds. Keep cursor ownership and all unevaluated IDs intact at a budget stop.

### History pending resolution

`pending`/`isEarlierVersion: null` honestly expresses unread provenance, but it needs a concrete completion action. Implement and document either a bounded enrichment continuation or a read-only targeted material/event retry using an existing compatible reader. Keep event pagination and enrichment completion separate. Prove that two max-ASCII sets under 2 MiB initially defer one, then its supported action resolves it without losing/reordering/duplicating events or rewriting data. Repeated global refresh must not always consume the first set and starve the second. Add resource counters to this path and declare its return/retention limits.

Promote new frozen cases 1–5 and add normal-before/after-oversize traversal, oversize→valid live content replacement, malformed/ineligible prefixes, small-budget single lane, mixed sizes, pending counts and terminal-state tests. Replace the misleading submitted oversize assertion with an explicit reported outcome and later-material progress test. Use small synthetic fixtures, not enormous worst-case allocations.

## 2. C2-R8: finish strict complete schemas

New frozen cases 6–8 show:
- Owned v1 due token with `remIds: []`, `isExhausted: false`, no `lc/lp/lu` is accepted and restarts page 1.
- Owned due token with `remIds: ['a','a']` is accepted and may emit duplicates.
- History accepts `t: '2026-02-30T00:00:00.000Z'` and an ID of 65 characters, despite canonical time and 64-character limits being claimed.

Validate all token fields **before SQL**. Due continuation needs complete typed/bounded candidate boundary, supported integer priority rank, canonical update instant, boolean exhaustion, unique bounded pending string IDs and mandatory normalized filter/clock context. History needs canonical timestamp, bounded nonempty event ID and typed normalized material/topic context. Require exactly v1 and the correct kind; reject malformed/partial/wrong-type fields with `INVALID_CURSOR`, ownership mismatch with `STALE_CURSOR`. Null/absent cursor alone means first page; an incomplete v1 continuation cannot mean first page. Validate supported query filters and normalize clock inputs consistently.

Reuse C1's `isIsoInstant` where canonical instants are required. `Date.parse` alone normalizes invalid calendar dates and accepts noncanonical strings. Derive encoded/decoded bounds from supported field limits; generated tokens must satisfy the same decoder. Retain valid page-size changes and the passing 250-UUID case. Promote these exact tests and extend partial keys, wrong boolean/rank, duplicate IDs, overlong fields, invalid context/filter and decoder size cases.

## 3. C2-R10 inspection: honor scheduler ownership and valid state

`validateScheduleState` defaults missing scheduler version to simple-v1. History invokes it without the row's actual scheduler context, inventing a **1d** interval for an event under `unsupported-v99`. It also accepts normalized Feb 30 timestamps and negative reps/lapses.

Pass verified event scheduler context into validation. Explicit unsupported state or event versions yield null validated schedule/interval fields, while raw audit strings and parsed audit data remain available. Missing legacy state version may inherit only an explicitly verified supported event version, not a global default. Keep compatibility for supported legacy events exercised by earlier frozen tests.

Use production `SCHEDULER_VERSION`, `LADDER_DAYS`, `AGAIN_DELAY_MINUTES` and `isIsoInstant` rather than retyping scheduling contracts. Validate object/null shape, finite allowed integer step, date values and nonnegative safe optional count fields. Define absence/null fallback explicitly; malformed/wrong-type data must not become a supported interval. Never rewrite historical state. New cases 9–10 must fail before/pass after; supported 16-day control must remain passing. Add unsupported event with supported/missing state version, invalid dates, negative/fractional/wrong-type counts, absent state and valid Again/day ladder cases.

## 4. Align the supporting scope and production prompt

- Benchmark still uses an uncapped duplicate loop labelled `pipeline_breakdown_actual_rows` / actual ranking. Remove it, instrument the real reader, or rename/document every component as approximate. Valid full-reader timings can stay; do not claim IPC/WebKit measurements.
- Explain UTF-8 **and JSON escaping** honestly. A max-length Unicode fixture is not a universal serialized bound; the exact escaped fixture above exceeds 8 MiB. Raw whitespace/extra fields also need the absolute cap.
- Declare typed oversize/deferred outputs/actions, work counters/reservations, history pending completion and full cursor schema/bounds in the conditional prompt. Its history SQL section still tells the implementer to perform an unbounded batched raw read; replace that with the actual bounded policy. Keep measured per-set call counts accurate.
- Fix relative Markdown links: from a file in `docs/`, target a sibling filename, not `docs/<filename>` (which becomes `docs/docs/...`). Verify destinations exist. Keep no-additional-C2-migration language; schema-11 upgrade still executes shipped 0012.
- Record both implemented changes and remaining limitations honestly; do not call the full contract complete because the earlier diagnostics pass.

## Focused gate, package and stop

Read/copy the new frozen file from `origin/main:docs/evidence/m2-card-review-c2-bounds-rereview-2026-10-07/diagnostic.test.mjs`, preserving it unchanged and the dirty delivery files. Reproduce **1 control pass / 10 assertion failures**, exit 1, against the latest submitted model. Target the new model using:

```sh
C2_REVIEW_MODEL=/absolute/path/to/new/proof/contractModel.mjs \
  /opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test <frozen-file>
```

Run from repository root. Run all six frozen files unchanged under `docs/evidence/`: `m2-card-review-c2-review`, `rereview`, `completion-review`, `final-review`, `pipeline-review`, `bounds-rereview` (all suffixed `-2026-10-07/diagnostic.test.mjs`): **9 + 12 + 16 + 11 + 8 + 11 = 67 passes**, zero failures expected. Keep origin hashes/import locations. Do not weaken assertions or hide failures.

Run the new focused proof, baseline/four-mutant verifier/survival control, actual SQL and work accounting, representative final-reader performance only. No unchanged app/native/Xcode gates. Show meaningful fail-before/pass-after for permanent regressions. Tools must write new receipts, never prior pack files.

Deliver README/report, issue-to-fix mapping with exact tests, raw stdout/stderr/exit/command/cwd/toolchain receipts, four live-document snapshots, source-hashes manifest and SHA256SUMS. Verify hashes and all six prior packs before handoff; identify any intentionally corrected old test expectation. STATUS/handoff say “corrected, pending independent review,” not accepted. Report precise HEAD/branch/staging/commit state. Leave uncommitted and stop for the reviewer; do not add a new roadmap or owner-approval detour.
