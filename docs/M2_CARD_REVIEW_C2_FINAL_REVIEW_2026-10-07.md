# M2 Card Reviews C2 — Final-corrections re-review (7 October 2026)

**Disposition: preserve the verified fixes; complete R8/R9/R4 and the owner-mutation evidence before scope acceptance.** This is a planning/proof review. C1 acceptance remains intact. C2-D1–D9 remain proposed, and production C2 is not activated.

## Exact source and results

Reviewed `/Users/rickymac/code/Flight-training-pr70-integration`, dirty branch `codex/m2-card-review-c2-scope`, HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`. **34/34 submitted delivery hashes match.** All three earlier evidence packs match their published originals, and the production pure imports match main. The reviewer did not edit/stage/reset/switch the implementation clone. Independent execution used an isolated worktree based on `94bded3fd5c2cdc27bd197f84ee2e2a3f7d271bc`.

| Independently executed check | Result |
|---|---|
| All three frozen diagnostics, unchanged | **9/9 + 12/12 + 16/16**, exits 0 |
| Submitted proof | **24/24**, exit 0 |
| New focused diagnostic | **2 controls pass / 9 assertion failures**, exit 1 |
| Submitted child-process mutation verifier | Exit 0; survival-control test exit 0 |
| Owner-worker baseline control, injected mutation removed | Still fails its lock assertion, exit 1; the owner worker is not a meaningful mutation proof |
| Actual SQL first-page/continuation audit | Due: 3 calls each; history: 2 calls each; exit 0 |

[Runnable evidence, raw receipts and manifests](evidence/m2-card-review-c2-final-review-2026-10-07/README.md) accompany this review. Submitted final-corrections evidence is published byte-for-byte as an unaccepted snapshot. Existing timing receipts were inspected rather than rerun. No unchanged app/native/Xcode matrix, application/profile, provider, installed or release operation was performed.

## Verified fixes that must remain closed

The 14 previous failing behaviors now pass: due/new and history filters, initial cursor filter/clock ownership and live deletion/content revalidation, basic history-event identity, live synchronous throw→retry, refreshed existing summary values, idle filter invalidation, valid-empty provenance and prior/next event state. Production C1 validation/scheduling, shipped-schema initialization, actual SQL batching and previous urgency ordering also remain passing. File-backed discovery/history reopen and schema-11→12 tests pass. The mutation runner now enforces subprocess assertion failures and detects surviving mutants; retain that improvement.

The remaining failures are consequences in the corrected paths, not grounds to reopen those settled contracts.

## R8 continued — P1: pending consumption and history cursor ownership

Submitted `proof/contractModel.mjs` line **330** uses `decoded.remIds.slice(limit)` after filtering deleted/non-actionable IDs and slicing the filtered results. Those are different sequences. With materials A/B/C/D, first page A, then B deleted or changed to `[]`, the complete traversal returns **A/C/C/D**, not A/C/D. The current single continuation test sees only the first C and misses the later duplicate. Counts/progress based on pages become incorrect.

**Fix:** advance by actual consumed pending identities, including discarded IDs, rather than a numeric offset into the original list. Example: pending `[B,C,D]`, B discarded, C emitted → only `[D]` remains. Preserve unvisited candidates when a work limit interrupts evaluation. Test the entire ordered traversal after prefix/middle removals and eligibility changes, including a changed page size, not only one page. New diagnostic cases 1–2 fail.

Due cursor validation at lines **255–269** makes `ctx` optional: `{type:'due', remIds:['a'], isExhausted:true}` bypasses ownership and is accepted. The payload is not versioned or bounded as promised. History at lines **517–580** applies filters correctly, but never validates cursor kind/context; a material-B history cursor used for material A can silently return no rows despite A's events being present.

**Fix:** require version/kind/normalized query context and shape/size bounds for both cursor types. Cross-filter tokens must be rejected explicitly or deliberately restarted; page-size changes may remain compatible. New cases 3–4 fail. Keep the already-passing live database revalidation and original keyset/forward-continuation cases.

## R9 continued — P1: refresh replacement; P2: synchronous ownership

`onReset` at lines **808–815** retains other loaded rows, clears the cursor, and starts a fresh traversal when its caller reads again. Lines **756–764** replace only returned entries at their old positions. This cannot remove absent rows or adopt fresh order:

- Loaded `[A,B]`; reset A; fresh authoritative result `[A]` → B remains, although no longer actionable.
- Loaded `[A,B,C]`; reset C; fresh result `[B,A,C]` → old `[A,B,C]` order remains.

**Fix:** restart a generation from empty rows/counts/cursor, then append its ordered pages, or implement an equally explicit full authoritative reconciliation. Do not use append/replace-at-old-position as a first-page refresh. Clear obsolete errors/failed cursors coherently and specify who initiates the read. New cases 5–6 fail; preserve event-ID history dedup and normal read retry.

The reader is still invoked before the owned busy operation is installed. In the injectable synchronous boundary at lines **727–740**, A can invalidate its generation, start a genuinely held B, then throw; A's catch unconditionally clears B's busy/loading state. Error publication is guarded, but lock release is not.

**Fix:** install an owned operation before reader invocation, and guard every catch/finally publication/release by the exact live owner. New case 7 fails; the live synchronous throw→retry control passes. This is a contract-boundary test, not a claim of an observed installed-app failure.

## R4 continued — P1: proposed resource bounds are not executable

`maxBatchCardsBudget` and `maxBatchRawJsonBytesBudget` appear only in benchmark/document proposals; neither is used by the reader or declared in the conditional input API. `evaluateCandidates` at line **133** first fetches every raw candidate set and then derives every valid card/version/item. The submitted claim that the reader yields at these caps is false.

Small, production-valid fixtures reproduce this directly:

- Six materials × 500 short cards, requesting the proposed 2,500-card budget → **3,000 cards** in the returned evaluated batch, no resource-budget continuation.
- Two materials × 500 cards, each side at the accepted ASCII limits, requesting 2 MiB → **3,041,002 raw bytes** returned from SQL before any ceiling. This test uses about 3 MB, not a huge artificial database.

**Fix:** implement requested/default caps in the actual read path, before payload transfer/expensive derivation, with explicit counters and forward continuation for every unprocessed candidate. A SQL metadata preflight using stored-byte lengths, bounded sub-batches or another supported read-only design is acceptable; demonstrate native/browser SQL compatibility. Counting only emitted rows after hashing the whole batch is insufficient. New cases 8–9 fail. They explicitly request the proposed budgets, so a justified change to defaults does not excuse ignoring a valid requested limit.

Define a no-livelock policy for one legitimate set larger than the normal batch budget: deliberate bounded single-set admission, an explicit deferred/oversize entry with a review path, or a justified revised bound. No silent loss, endless empty continuation or false caught-up state. Retain C1's accepted limits.

The claimed worst-case `125000 × 250 bytes ≈ 31 MB` is an estimate for short cards, not an upper bound: the diagnostic's single max-ASCII 500-card material alone is about 1.52 MB. The “max-text Unicode” benchmark uses roughly 80/190-character sides, not the accepted 1000/2000 maxima. Remove those labels/timing predictions or measure genuine bounded fixtures. Its component summary/sort is still a separate twin: it uses `<= midnight` instead of `<`, and due-before-priority ordering instead of the final priority-before-due ordering. Instrument the actual reader or label the breakdown as approximate. Keep valid whole-call measurements and unmeasured desktop/WebKit labels.

## Owner-mutation evidence and final document cleanup

`runMutants.mjs` owner worker holds A but not B. By the time `await pA` finishes, B has naturally settled. The worker then forces `busyPromise = null` and asserts it is non-null. The reviewer removed that injected assignment in an isolated copy; it still fails with the same assertion. The baseline worker also never exercises owner-lock behavior.

**Fix within the R9 work:** use independently held A and B, prove the ownership assertion passes on baseline while B is pending, then run the same assertion with a stale-release mutation and require its intended failure. Keep the now-working verifier/survival control and the other meaningful negative cases.

Finish the conditional prompt in the same package: declare the actual resource options/counters/cursor schema and oversize policy; specify reset replacement/invalidation and historical read-only inspection target/state/nullable interval presentation. Avoid `unknown` placeholders presented as complete runtime state validation. Use portable repository-relative documentation links. Remove the remaining “completely eliminates migration risk” sentence; accurately retain “no additional C2 migration.” These are completion details for the already-requested scope, not new production work.

## Next action

Execute [the focused read-pipeline correction prompt](M2_CARD_REVIEW_C2_READ_PIPELINE_CORRECTIONS_PROMPT_2026-10-07.md) in the existing dirty planning clone. Preserve all four evidence packs and the 37 verified cases. Deliver one corrected proof plus supported scope/conditional implementation prompt uncommitted/unpushed. Owner approval is requested only after the package is independently accepted.
