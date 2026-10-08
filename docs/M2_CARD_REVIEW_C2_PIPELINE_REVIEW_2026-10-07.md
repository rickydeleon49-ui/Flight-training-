# M2 Card Reviews C2 — Read-pipeline review (7 October 2026)

The submitted corrections make useful progress, but the C2 planning package is **not yet accepted**. Preserve the passing refresh/ownership and pending-consumption fixes. Finish resource accounting, cursor bounds/schema and the supporting contracts in [one model-neutral assignment](M2_CARD_REVIEW_C2_BOUNDED_READ_CORRECTIONS_PROMPT_2026-10-07.md). C2-D1–D9 remain proposed; production C2 and installed/release work remain outside this assignment.

Reviewed the dirty `codex/m2-card-review-c2-scope` implementation clone at `9028675475616ce338253ae7e4e46ba6b840b72c`, using an isolated review worktree based on `origin/main` `f6064ef26794f0de626eabce9be80260a15a0908`. All **38 submitted source hashes** and **34 evidence checksums** match. The implementation clone was not modified. The new submitted evidence is published byte-for-byte, together with its four delivery-document snapshots.

## Verified fixes and checks

- All four frozen reviewer files pass unchanged: **9 + 12 + 16 + 11 = 48** cases, exit 0.
- Submitted proof passes **32/32**, exit 0, from the repository root. The first reviewer invocation from `proof/` failed two cwd-dependent file-backed cases; that receipt is retained, and the corrected root invocation passes. This is not a source regression.
- Mutation baseline passes, four semantic mutants are killed by assertions, and the survival control correctly rejects a surviving mutant. The independently held A/B owner fixture now works.
- Authoritative reset replaces stale rows/order; operation ownership is installed before synchronous reader invocation. Pending-prefix deletion/empty-content traversal and cross-filter context rejection now pass.
- Independent SQL audit reproduces submitted counts: due first page **218 calls**, pending continuation **150**, filtered due **217**; history first/continuation/filter **2** each. Raw reads are now per candidate, not one batched raw read. These Node SQLite counts do not by themselves prove unacceptable desktop latency, but the scope/prompt must describe the executed design accurately.
- Additional frozen diagnostic: **one control passes / seven assertion failures**, exit 1. [Diagnostic and independent receipts](evidence/m2-card-review-c2-pipeline-review-2026-10-07/README.md).

## C2-R4 remains open — actual work escapes the resource budgets

Source: submitted `proof/contractModel.mjs`, discovery loop (approximately lines 540–593), pending loop (approximately 353–413), history raw enrichment (approximately 776–820).

1. **Invalid discovery prefix:** four malformed 700,000-byte strings transfer **2,800,000 bytes**, despite a 2,097,152-byte limit. Byte admission is guarded by `admittedCandidates.length > 0`; invalid sets never make this true. In pending traversal the guard uses `page.length > 0`, so ineligible work also bypasses the cap until a row is emitted.
2. **Pending accounting:** mutate four pending valid sets to those malformed strings. The continuation transfers **2,800,000 bytes**, but reports **`rawBytesTransferred: 0`** and completes. Invalid parsing takes `continue` before accounting; it must still consume the read/work budget and preserve continuation at a stop.
3. **Card-budget boundary:** three valid 500-card materials, requested card budget 500. The call reads/parses two sets before stopping. Measured transfer is **48,562 bytes**, reported transfer **24,281**. Limiting admitted/returned rows cannot hide work already performed on the next candidate.
4. **History enrichment:** two individually legal max-ASCII 500-card sets transfer **3,041,002 raw bytes**. History ignores the applicable requested byte budget and has no independent bounded enrichment policy in its API.
5. **Unbounded single-set exception:** the first eligible/raw candidate is permitted at any byte size; there is no absolute maximum, explicit deferred result, or restriction to one already-counted unit of work. C1's parsed-card limits do not bound arbitrary stored JSON bytes before transfer. The exception must be bounded and discoverable, with forward progress and honest counters.

The first three new resource diagnostics and the history diagnostic reproduce items 1–4. Fix the executed pipeline and counters together; count invalid/non-actionable work independently of emitted rows. Keep all unvisited candidates/events reachable and incomplete state honest.

## C2-R8 remains open — generated cursor exceeds its own decoder limit

Source: `encodeCursor` / `decodeCursor` and both query validators.

At the documented maximum of 250 candidates, using ordinary 36-character UUID IDs and `limit: 1`, the reader issues a **13,296-character cursor**. The next call rejects it because `decodeCursor` caps input at **8,192**. Small batches passing does not establish pagination at the supported maximum. Define consistent encoded/decoded/ID-count/ID-length bounds or change the bounded representation; never return a token the reader cannot consume. Prove complete, unique traversal at maximum size, including live deletion and page-size changes.

Both readers accept missing `v` because the check allows `undefined`. Due pending IDs/key fields are not shape-validated. History accepts an owned-context token missing both `t` and `id`, silently restarting at page 1. Require a versioned complete kind-specific shape, canonical ownership values and typed/bounded fields; reject invalid tokens before SQL. The three new cursor diagnostics reproduce the generated-token, missing-version and incomplete-history cases.

## Supporting contracts/evidence still need correction

- Scope §6 and benchmark retain the **31.25 MB “upper bound”** based on 250 bytes/card. It is a short-card example, not a worst-case bound under C1's actual 1000/2000 code-point limits. The “max-text Unicode” fixture still uses roughly 80/190-character text, not those limits.
- Benchmark component timings remain a second implementation. It gathers byte lengths but then reads/derives all candidates without admission checks; labels such as `pipeline_breakdown_actual_rows` and “Urgency Ranking (actual)” overstate correspondence to the capped reader. Full-call timings remain legitimate for their stated fixture; do not reinterpret component timings as the executed bounded pipeline.
- The conditional prompt has useful inspection types, but no validated legacy-state contract or explicit nullable interval field/derivation rule. The proof only `JSON.parse`s states, allowing non-object/out-of-range/invalid-date values to reach typed results. Finish the previously requested validation/fallback contract without inventing scheduling intervals or rewriting legacy data.
- Local `file://` links remain in the scope/conditional prompt. Replace them with repository-relative links. Align budget inputs/counters, cursor schema, history policy and SQL call descriptions with final source. Do not claim all contracts are proven until these checks pass.

These are unfinished parts of the existing assignment, not an expansion of the roadmap. The [next prompt](M2_CARD_REVIEW_C2_BOUNDED_READ_CORRECTIONS_PROMPT_2026-10-07.md) specifies exact reproduction, implementation options and acceptance criteria. C1 acceptance and prior owner decisions persist.
