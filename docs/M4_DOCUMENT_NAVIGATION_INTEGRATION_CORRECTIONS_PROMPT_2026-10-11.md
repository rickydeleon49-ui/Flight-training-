# M4 preparation: integrated corrections R9–R12

ACTIVE, model-neutral. Finish one coherent navigation/persistence preparation contract and its evidence. This supersedes `M4_DOCUMENT_NAVIGATION_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md` for the current submission; retain successful work from earlier rounds. M4 production and owner defaults remain conditional/proposed. M3 is approved and running separately.

## Starting state

Use only `/Users/rickymac/code/Flight-training-m4-viewer-evaluation`, branch `codex/m4-navigation-viewer-evaluation`, HEAD `c28ab8482c8635b0b2bf74686b081e02bf448f65`. Fetch. Read this full prompt, `docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_REREVIEW_2026-10-11.md`, and its `docs/evidence/m4-document-navigation-integration-rereview-2026-10-11/` README, submitted hashes, diagnostics and runtime receipts from origin/main if missing. Do not pull/reset/stash/clean or overwrite the dirty checkout. Verify32 frozen submitted hashes,28 current checksums,40 previous-review checksums and29 first-review checksums before editing. Report any competing edits; preserve them safely. Keep primary, M3 worktrees and shared ROADMAP/STATUS/PROJECT_HANDOFF untouched.

Reproduce in disposable copies: disclosed Node26 suites22 pass; earlier diagnostic10 pass; previous adapter14 pass/1 historical scanner failure legitimately superseded by current PDF.js proof; new diagnostics14 failures/2 controls. Preserve the Node22 PDF.js `Promise.try` failure receipt as a scratch runtime limitation. A parser supported in the declared scratch runtime is sufficient; no production polyfill/app change is requested.

## R9: validate the complete destination, using actual nullable row shapes

Define one explicit resolved/unresolved destination contract carrying material ID, coordinate space, originating/current content identity, physical page and trusted safe page count. Use it from resolver through opener/persistence proof. Missing or malformed counts (undefined/null/NaN/infinity/fraction/string) must not bypass bounds and resolve. Explicit physical input with unknown count may retain intent/guidance but cannot be a verified active destination. Printed maps must be verified, content-bound and bounded; legacy integers/strings stay unresolved without provenance.

Make translation validation direction-specific. A legitimate first-level schema13 row has nullable absent parent ranges: this must not prevent valid child→root navigation. Nested parent navigation requires complete consistent parent ranges and a live bounded parent identity. Root navigation requires complete consistent root ranges and identity/count; reverse navigation requires the live child ID/count. Validate safe arithmetic/results and whole relevant ranges. Deleted/unknown destinations return unresolved snapshot guidance. Do not conflate absent unrelated parent fields with malformed required fields.

Promote all six R9 cases and add valid first-level/nested/root-to-child controls, missing/deleted parent/root, unknown identity/count, stale maps and overflow. Reuse shared validation rather than scattered optional guards. Old diagnostics with incomplete setup may use a disclosed minimal valid-fixture adapter; never weaken the expectation that unknown destinations stay unresolved.

## R10: one atomic persisted replacement/revalidation operation

Replace the exposed “save identity then optionally reconcile” sequence with a reusable top-level protocol that validates observed canonical content identity/count and atomically updates identity plus bookmark/reading validity. Prior-content records retain original hashes/coordinates and become visibly unverified. Unknown/missing/inconsistent identity must not be active. Matching hash without trusted bounds/provenance cannot reverify. Navigation writers must consult persisted current identity and reject or quarantine incompatible/out-of-bounds inputs rather than accepting caller-selected verified/active status.

Apply candidate DDL only to disposable databases, unregistered/provisionally numbered. Populate real shipped schema1–13 BEFORE applying candidate DDL; compare all relevant prior row values/lineage afterward. Test file-backed close/reopen, identical/changed replacement, A/50→B/10, mixed generations, unknown identity, safe deliberate revalidation, and cascade.

Fault the actual replacement operation after identity/bookmark/reading changes using injected failure/SQLite triggers, and prove rollback restores all rows. Test actual synthetic file snapshots and computed hashes across backup/restore, including changed and missing document files. A clean DB copy is useful but is not the application's full backup compatibility proof. Exercise existing schema-ledger/older-binary refusal using an isolated faithful compatibility probe or existing validator, with a documented provisional candidate version and accepted-base identity. No production backup or migration-registry modification is authorized. Reuse existing reopen/cascade proofs.

## R11: fence durable save ownership, not just UI callbacks

Capture immutable intent, route/material ID, content hash and validated destination before awaiting. Advance route/intent ownership before all validations. Scope progress by material AND content, including return values and public getters; same-ID replacement cannot inherit page42 from old bytes, and failed B cannot expose A through another accessor.

Validate trusted known bounds before invoking the opener. Unresolved labels may use explicit native-open guidance without inventing a persisted physical page. Preserve working early missing-path supersession and abort behavior.

Define the injected persistence contract so an obsolete save cannot commit over a newer destination. A check after awaiting is insufficient. Use operation/content ownership validated at commit, a transaction fence, or an equivalent documented serialized protocol; do not rely on cancellation signals without commit enforcement. Demonstrate with SQLite: hold old page42 save, commit newer page3, release old save; final DB must remain3. Cover same-content requests, changed-content same-ID requests, route A→B→A, abort/unmount, delayed failure and late callbacks around every await. A new persistence-interface adapter is allowed when disclosed and when it actually enforces commit ownership; keep the held-write order and final-database assertion unchanged.

If opening succeeds but saving fails, report that partial outcome accurately and offer a deliberate save-only retry carrying the same immutable valid ownership. Do not reopen the document, silently retry a stale write, claim the position was saved, or mark reading confirmed. Demonstrate recovery and supersession with actual injected durable protocol.

## R12: reproducible proof and complete handoff

Keep the successful real PDF.js parser demonstration. Bind scratch dependencies to exact versions and record resolved artifact integrity plus actual engine/worker/font/WASM/native optional dependency identities and relevant package LICENSE/NOTICE inventory. Inspect the exact evaluated/compared package artifacts rather than inferring bundled notices from moving-main URLs. Do not commit node_modules or activate production dependencies. Pin an explicit supported scratch runtime; retain both Node26 success and Node22 failure honestly. Use task cleanup in `finally` for success and rejected loads; do not claim measured buffer release or old WKWebView compatibility from Node parsing.

The runner must run current-source diagnostics/equivalents, separately label historical reproductions, validate actual counts/exits, and fail on missing/unexpected results. Retire the scanner diagnostic only with an explicit map to the real PDF.js replacement proof. Existing toy sensitivity examples may stay explanatory, but add actual disposable module-copy guard reversions and run unchanged regressions against them: baseline0, mutant1, correct named assertion failure. Restore/check source hashes after mutants; never mutate the live dirty worktree.

Synchronize evaluation, acceptance criteria, conditional implementation prompt, issue/test map and correction report with final integrated APIs: trusted bounded destinations/maps; atomic replacement/revalidation; content/intent-scoped durable commits; partial-save recovery; authoritative backup restoration and older-version refusal. Keep candidate migration number provisional until accepted-main/M3 reconciliation. Use “Last requested page”; confirmed page reading does not imply document completion. OD-1–OD-10 remain proposed.

Preserve ALL prior raw receipts and frozen snapshots. Create a distinct new correction pack, full manifest covering changed top-level docs and proof, exact commands/runtime/exits/counts, final checksums and proposed tracking entries. Do not strip raw receipt/PDF structural formatting. Correct premature all-resolved claims with evidence.

## Final gate and stop

Run focused current proof, adapted frozen diagnostics, meaningful current regressions/sensitivity and real candidate SQLite lifecycle checks. No whole-app matrix, new platform audit, real-user data, physical login, provider call, signing/build/release, production edit or shipped migration registration is needed. Both dirty primary and M3 worktrees remain protected; G1–G3 deferred/unexecuted/unverified.

Deliver one complete correction report, coherent revised conditional prompt, new evidence/source/checksum manifests and concise handoff. Leave changes uncommitted/unpushed for independent senior review, then stop.
