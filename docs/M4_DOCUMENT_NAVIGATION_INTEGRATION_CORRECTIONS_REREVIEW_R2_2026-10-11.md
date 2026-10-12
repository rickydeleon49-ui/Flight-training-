# M4 integration corrections re-review (round 2)

11 October 2026. **CORRECTIONS REQUIRED: M4-R13–R22. M4 production remains conditional; OD-1–OD-10 remain proposed and are not presented for approval here.**

Subject: the M4-R9–R12 correction package in `/Users/rickymac/code/Flight-training-m4-viewer-evaluation`, branch `codex/m4-navigation-viewer-evaluation`, base `c28ab8482c8635b0b2bf74686b081e02bf448f65`, with `docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_REPORT_2026-10-11.md` and `docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/` (27 delivered files). Reviewer base: accepted main `c32918b` (M3 production merged as #140). [Evidence, byte-faithful submitted copies and reproducers](evidence/m4-document-navigation-integration-corrections-rereview-2026-10-11/README.md).

All findings below were reproduced independently against archived copies of the submitted modules, in both the project Node 22.23.3 lane and the disclosed Node 26.10.0 lane. Nothing here reopens settled R5–R8 scope.

## Retained work, independently verified

The round genuinely advanced the contract, and this work must be preserved:

- **R9 core bounds.** Missing/malformed counts (`undefined`/`null`/`NaN`/`Infinity`/`2.5`/`"50"`) no longer resolve a physical destination; printed label maps are now bounded; direction-specific translation accepts the genuine first-level schema-13 row shape with `parentPageStart: null`/`parentPageEnd: null`, requires complete consistent root ranges with range length matching `childPageCount`, requires a live child `materialId` for reverse navigation, and returns structured `ROOT_DELETED`/`PARENT_DELETED` guidance. Inconsistent counts are refused.
- **R10 atomicity is real.** `replaceContentIdentity` runs one `BEGIN IMMEDIATE TRANSACTION` covering identity upsert plus bookmark and reading-state invalidation; `saveContentIdentity` delegates to it; writers consult the persisted identity; reconciliation refuses to reverify with a matching hash when bounds are unknown.
- **R10 lifecycle proof is substantially completed.** The upgrade test now populates `study_materials`, `notes` and `material_split_lineage` **before** applying candidate DDL; the rollback test faults the actual replacement transaction via a `BEFORE UPDATE` trigger on reading state, i.e. after identity and bookmark writes, and asserts all three row sets return to their prior values; close/reopen uses a file-backed database; backup/restore creates real document bytes, detects modification, handles deletion and re-verifies restored hashes; cascade deletion is exercised.
- **R11 content scoping and save-only recovery.** Progress is keyed `${materialId}:${contentSha256}`, the public getter no longer leaks a previous generation after a failed replacement, out-of-bounds destinations refuse before the opener is invoked, and `retrySave()` completes a partial save without replaying the opener (asserted by call counters).
- **R12 sensitivity is now real.** Five disposable module copies in `mkdtemp` directories, one guard reverted per copy, unchanged regressions run against them, each failure asserted to be an `AssertionError` naming the expected message, copies destroyed, live source hashes re-verified. Historical reproductions are separated from current acceptance in the runner.
- **R12 artifact audit is genuine.** `pdfjs-dist` pinned exactly, lockfile with SHA-512 integrity, `scratch-artifacts.json` recording license, resolved tarball, optional native dependencies and asset checksums. The recorded `evaluated_assets["pdf.mjs"]` value equals the SHA-256 of the file that actually executed — I verified this independently.
- **Boundaries respected.** `git diff` empty in the submission worktree; 0 production, dependency, migration or shared-tracking edits; the merged rereview pack in that worktree is byte-identical to `origin/main`; the primary checkout and the M3 scope worktree had no file modifications in the review window. The prior positive controls and frozen diagnostics still behave as before.
- **Determinism.** The three suites pass identically on both lanes: `proof.test.mjs` 21/21, `databaseLifecycle.test.mjs` 7/7, `sensitivityMutants.test.mjs` 2/2, all exit 0. The PDF.js demonstration is a real parser proof on 26.10.0, including rejecting the forged `/Count 99` catalog by traversing actual leaves.

No whole-app matrix, installed run, build, signing, provider call or platform audit was performed or needed.

## M4-R13 — P1: the obsolete save still commits; the "fence" is a compensating rewrite that can fail silently

`proof/openerController.mjs:170–190`. `DocumentPersistenceProtocol` (`proof/persistenceProtocol.mjs:169–219`) accepts no ownership token: `saveReadingState` never reads the `intentId` the controller passes at `openerController.mjs:158–163`, so nothing rejects an obsolete write at commit. The controller then re-asserts the newer page **after** the stale write landed.

Reproduction (`receipts/repro-node22-v22.23.3.txt`, id `R13-obsolete-write-commits`): hold the page 42 callback, commit page 3, release. Durable write sequence is `3 → 42 → 3`. `obsoleteValueCommittedToSqlite: true`.

Worse, the repair is swallowed: `openerController.mjs:176–184` wraps it in `catch { // Ignore secondary repair errors }`. With the repair write made to fail (id `R13b-repair-failure-silent`):

```
finalDurablePage: 42, returned: {success:false, state:"aborted", lastRequestedPage:3},
surfacedError: null, notice: "…Turn to page 3 (printed 'three')."
```

**Expected (R11 as assigned):** an obsolete save cannot commit over a newer destination; a check after awaiting is explicitly insufficient. **Actual:** the obsolete destination wins permanently, the caller is told page 3 is current, and no error is surfaced. **Impact:** silent durable navigation corruption plus a false "saved" notice — the exact defect R11 was raised for, now reachable through the fix itself. The submitted test passes because it asserts only the final page value and never observes the write sequence.

**Smallest coherent fix:** give the durable contract commit-time ownership. Add a fenced writer to the protocol that carries the immutable operation identity and rejects at commit inside its own transaction (e.g. `UPDATE … WHERE material_id = ? AND owner_generation = ?`, or an equivalent serialized protocol), returning `committed: false` for obsolete generations; have the controller consume that result instead of writing again. Keep the frozen held-write order and the final page 3 assertion, and additionally assert the obsolete value **never** reaches storage and that a rejected repair failure cannot exist.

## M4-R14 — P1: the compensating rewrite republishes the obsolete content hash and printed label

`proof/openerController.mjs:177–181` re-invokes persistence with the **old** intent's `pageLabel` and `material.contentSha256` while writing the newer page number.

Reproduction (id `R14-repair-publishes-obsolete-identity`): newer request is content `SHA_B`/label `printed-B-label`; after the obsolete release the durable row is `{page: 3, sha: "aaaa…", label: "printed-A-label"}` — `repairStampedOldContentHash: true`, `repairStampedOldLabel: true`. In the single-content case (id `R13-obsolete-write-commits`) the final row is `page 3` with `label "forty-two"`.

**Expected:** R10 requires rows whose content identity mismatches the active generation to be visibly unverified, and the immutable (content, label) tuple to belong to the owning operation. **Actual:** the fence manufactures a row that asserts an obsolete generation while holding a newer page. **Impact:** a bookmark/reading row that looks verified but points at the wrong document generation; misdisplayed printed label; R10's own invalidation rule is defeated by an R11 code path. **Smallest coherent fix:** none is possible while the repair exists — removing it (R13) removes this defect. If any recovery write is retained, it must carry the owning operation's full immutable tuple and be covered by a dedicated assertion.

## M4-R15 — P1: translation still produces a successful destination when the destination count is unknown

`proof/contractModel.mjs:276` and `:321` guard the count only `if (lineage.sourceTotalPages !== undefined && !== null)` (and the `parentTotalPages` equivalent), so an absent count skips bounding entirely.

Reproduction (id `R15-unknown-destination-count-resolves`), `child_to_root` with page 12 over range 1–16: `count_200 → success`, `count_null → success`, `count_absent → success`, `count_undefined → success`; only the inconsistent `count_5` is refused. `child_to_parent` behaves identically with an unknown `parentTotalPages` (id same receipt, `childToParentUnknownCount.success: true`).

**Expected (R9 as assigned):** root navigation requires complete consistent root ranges **and identity/count**; input with unknown count "cannot be a verified active destination". **Actual:** an active `destinationSpace: "root_physical"` destination whose bounds are unproven, so page 12 may exceed the real root document. **Impact:** the same unknown-count class R9 was raised for, relocated from the resolver to the translator. **Smallest coherent fix:** require a trusted safe-integer destination count for `child_to_root` and `child_to_parent` (refuse with unresolved guidance when absent), and promote negative cases for each direction to permanent regressions.

## M4-R16 — P1: printed label maps are bounded but still not content-bound

`proof/contractModel.mjs:159–185` never consults `options.contentSha256`, although its own JSDoc (`:42`) declares it. The resolved record has no identity field.

Reproduction (id `R16-label-map-not-content-bound`): resolution returns `resultKeys: "isResolved,physicalIndex,isPureIndex,pageLabel,mapped,provenance"`, `carriesContentIdentity: false`, and `staleMapForDifferentContentResolvesIdentically: true` — the same map built for content A resolves unchanged for content B.

**Expected (R9 as assigned):** printed maps "must be verified, **content-bound** and bounded"; the prior review named content binding as the reason a bare map cannot become a verified destination. **Actual:** only the bound half landed. **Impact:** a stale page-tree map from a replaced document still resolves an active physical page. **Smallest coherent fix:** bind the map to a content identity (the map supplies `contentSha256`; resolution requires it to equal the trusted current identity) and carry material ID, coordinate space, content identity, physical page and trusted count in the resolved record; add a stale-map negative test.

## M4-R17 — P1: no single validated destination record is used from resolver through opener and persistence

The resolver returns page/provenance fields only, the translator returns page plus material ID only, and `openerController.mjs:100–120` re-derives bounds from caller-supplied `material.totalPages`/`material.contentSha256` rather than consuming a validated destination; the durable writer separately consults `material_content_identities`. The three layers are each tested but never composed, so the opener's trust ceiling is whatever the caller asserts.

Reproduction (id `R17-opener-trusts-caller-count`): with the persisted identity stating 10 pages, `requestOpen({...material, totalPages: 50}, 42)` is accepted, the opener is invoked at page 42, and the row is persisted.

**Expected (R9 as assigned):** "Define one explicit resolved/unresolved destination contract carrying material ID, coordinate space, originating/current content identity, physical page and trusted safe page count. Use it from resolver through opener/persistence proof." **Actual:** five attributes remain spread across three shapes and the chain re-validates independently. **Impact:** an inflated or stale caller count bypasses pre-opener bounding; production callers get no compile-time/type-level guarantee that an opener may only receive a validated destination. **Smallest coherent fix:** introduce the single resolved/unresolved destination record, have the resolver and translator produce it, and make the controller accept only that record (bounds sourced from the trusted count it carries), with one composition test proving resolver → controller → protocol cannot open an unbounded destination.

## M4-R18 — P2: the "safe integer arithmetic" case proves a different guard, and the arithmetic guard is unreachable

`proof/proof.test.mjs:149–152` names the case "translated arithmetic must remain a safe integer" but its fixture omits `sourcePageEnd`, so it is refused by the range-completeness check at `contractModel.mjs:257`.

Reproduction (id `R18-overflow-guard-unreachable`): `namedCaseError: "Missing or invalid sourcePageStart/sourcePageEnd for root translation"`; `blockedBy: "range-completeness guard (not the arithmetic guard)"`. With the widest range that satisfies every other invariant (`start = MAX_SAFE_INTEGER-15`, `end = MAX_SAFE_INTEGER`, `childPageCount: 16`, `page: 16`), translation succeeds with `rootPage: 9007199254740991`; because `rootPage ≤ sourcePageEnd` is already enforced, the check at `contractModel.mjs:272–274` can never fire. Deleting it changes no outcome.

**Impact:** an assertion that passes for the wrong reason creates false confidence — the same failure class as M3P-R6 in the M3 round. **Smallest coherent fix:** either remove the dead guard as part of R17's unified record (documenting why the range invariant makes it unreachable) or add a fixture that overflows before any other check and rename the case after the guard that actually fires; add whichever remains to the sensitivity set.

## M4-R19 — P2: durable writers throw raw errors on unknown/missing content identity instead of persisting visibly unverified

`proof/persistenceProtocol.mjs:137` dereferences `bookmark.originatingContentSha256.toLowerCase()` unguarded; `:193` treats an absent `options.contentSha256` as "no mismatch" and keeps status `active` when the row otherwise fits bounds; the insert at `:214` then binds `undefined`.

Reproduction against the real schema path (shipped migrations + candidate DDL), id `R19-writer-unknown-identity-throws`: `addBookmark_missing_hash → TypeError: Cannot read properties of undefined (reading 'toLowerCase')`; `addBookmark_malformed_hash → CHECK constraint failed: LENGTH(originating_content_sha256) = 64 …`; `saveReadingState_missing_hash → Provided value cannot be bound to SQLite parameter 5.` on Node 22 versus `NOT NULL constraint failed: material_reading_state.originating_content_sha256` on Node 26 (compare both lane receipts).

**Expected (R10 as assigned):** canonicalize hashes, distinguish unknown/missing content, and "preserve incompatible rows visibly unverified"; failure mode should be deterministic. **Actual:** callers get engine-dependent raw exceptions. **Impact:** the "unknown identity must not be active" guarantee holds only by accident; a production UI would surface a SQLite binding error instead of an unverified position, and the message differs across engine lanes. **Smallest coherent fix:** validate and canonicalize at the boundary — absent/malformed identity yields a persisted `unverified` row (NULL where the schema permits) and the writer returns the applied status; keep the CHECK constraints as defence in depth and add a case pinning one deterministic message per lane pair.

## M4-R20 — P2: the pack's manifest does not describe the delivered bytes, and receipts are partly hardcoded constants

`shasum -a 256 -c SHA256SUMS` in the delivered pack fails for **6 of 26** entries — `receipts/01-toolchain.txt` … `receipts/06-sensitivity-mutants.txt`. The manifest was written at 13:26:50 and the receipts rewritten at 13:28:05 by the runner, which emits them last (`scripts/run_integration_proof.mjs:127–208`); the report's §8 "Authoritative Checksum Manifest" therefore does not match its own evidence. Machine-readable result: `receipts/manifest-node22-v22.23.3.json` → `recorded: 26, deliveredFiles: 27, matching: 20, stale: [6 receipts]`.

Independently re-verifying the frozen baseline (same receipt): **30 of 32** submitted paths unchanged; the 2 differences are exactly the two documents this round was required to revise (`M4_DOCUMENT_NAVIGATION_AND_VIEWER_EVALUATION` → `29d01efe…`, `M4_CONDITIONAL_IMPLEMENTATION_PROMPT` → `3f5c60d5…`, both disclosed in report §8.1). That final-state reconciliation appears nowhere in the pack: `receipts/02-baseline.txt` still asserts "Verified Hashes: 32 of 32 … Mismatches: 0", and the runner never hashes anything — `run_integration_proof.mjs:133` writes that sentence as a constant. Receipt `:182` likewise asserts "16 of 16 diagnostic assertions pass against current proof modules" with no executed step behind it (the frozen `diagnostics.test.mjs` targets the previous snapshot by design), and `:65` prints a fixed `(Node.js v26.10.0)` header regardless of the engine running.

**Expected (R12 as assigned):** exact commands/runtime/exits/counts, final checksums, and a runner that validates actual results and fails on missing or unexpected ones. **Actual:** narrative receipts generated as literals, stale manifest, no final-state baseline reconciliation. **Impact:** the pack's integrity claims are not checkable as delivered, and a future reader cannot tell measurement from assertion. **Smallest coherent fix:** make the runner compute the frozen-path and pack-own digests and derive every receipt line from captured output; emit `SHA256SUMS` last, after all receipts; record the 30/32-plus-two-disclosed-revisions reconciliation explicitly; re-verify `shasum -c` in the same run and fail on any mismatch.

## M4-R21 — P2: the older-binary refusal is a local tautology against a stale ceiling, and the lifecycle premise skips shipped migration 0014

`proof/databaseLifecycle.test.mjs:344–361` defines `maxShippedVersion = 13` inline with a locally written `verifyBinaryCompatibility` and never applies candidate DDL, never opens a database through a simulated older binary and never touches the schema ledger. Accepted main now enforces a real ceiling: `src-tauri/src/lib.rs:29` declares `CURRENT_SCHEMA_VERSION: i64 = 14`, compared at `src-tauri/src/backup.rs:631` (`newest_migration > crate::CURRENT_SCHEMA_VERSION` → refuse), with existing refusal coverage at `src-tauri/src/card_reviews_tests.rs:1098` and `src-tauri/src/skill_evidence_tests.rs:1008`. The assertion therefore tests its own constant, and its base identity (13) is already wrong by one.

Separately, `applyShippedMigrations` filters `Number(p.slice(0,4)) <= 13` and asserts "Must have exactly 13 shipped migrations" (`:25`), so on current main the suite silently omits the accepted M3 migration. I verified the substantive question myself (`receipts/coexistence-node22-v22.23.3.json`): applying **0001–0014** then candidate 0015 succeeds — 14 migrations, 44 tables, no number clash, bounded writers behave normally — so **numbering coexists** and candidate 0015 remains correctly provisional; the pack simply never proves it.

**Expected (R10/R12 as assigned):** exercise the existing schema-ledger/older-binary refusal with an isolated faithful probe or the existing validator, using a documented provisional candidate version and the **accepted-base identity**. **Actual:** an inline constant plus a stale migration premise. **Impact:** report §2.2 and README claim "older-binary refusal verified" and "candidate coexistence" ahead of the evidence; a real regression in the ledger check would not fail this test. **Smallest coherent fix:** drive the probe from the accepted base (14) — read the shipped migration directory and ledger rather than a literal, or reuse the existing Rust/node validator — apply candidate DDL to a populated database and confirm a simulated older binary refuses it; make the lifecycle helper apply every shipped migration and assert the count from the directory listing.

## M4-R22 — P2: the PDF.js step is not reproducible from the pack, and the recorded Node 22 limitation is an entrypoint choice

`proof/realParserDemonstration.mjs:15–19` resolves its engine from **the previous round's** directory: `docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/scratch/pdfjs-engine/node_modules/pdfjs-dist/build/pdf.mjs`. That `node_modules` is untracked and gitignored (`.gitignore:40`), the pack's own pinned `scratch/pdfjs-engine/` has no install, and `run_integration_proof.mjs` records no setup command (`npm ci` appears nowhere) — so from a clean clone step 4 cannot run at all. Verified by string inspection (id `R22-parser-path-and-engine`): `demoResolvesOtherPacksUntrackedNodeModules: true`, `demoUsesThisPacksPinnedScratchDir: false`, `runnerPerformsInstallStep: false`, `runnerHardcodesEngineLabel: true`, `runnerChecksProcessVersion: false`. The engine is also never asserted by the runner, so a receipt can claim v26 while any other engine executes it. There is no raw Node 22 failure artifact in the pack; the limitation exists only as prose in comments, README and `scratch-artifacts.json`.

Two consequences the reviewer had to resolve, and which the correction should adopt rather than rediscover:

1. Running the submitted demonstration unchanged on the project Node 22 lane is not a disclosed skip but an **uncaught crash** (`TypeError: Promise.try is not a function`, process exit 1) — raw capture in `receipts/parser-demo-node22-raw-failure.txt`. Because the runner writes receipts only at the end, a Node 22 run leaves the pack with **no** receipt and the previously written stale ones in place. `receipts/suite-rerun-*.txt` shows the three SQLite/contract suites are unaffected: 21/7/2, exit 0 on both lanes.
2. The pinned engine is **not** the limitation. `pdfjs-dist@6.3.289` ships a `legacy` build, and loading that entrypoint makes the entire five-fixture demonstration pass on **both** Node 22.23.3 and Node 26.10.0 with correct page counts (50/10/1/16) and the expected `InvalidPDFException` for the malformed fixture, each build evaluated in its own process to avoid cross-build contamination — `receipts/parser-legacy-entrypoint-lanes.txt`.

**Expected (R12 as assigned):** bind scratch dependencies to exact versions with the resolved artifacts used by the proof, pin an explicit supported scratch runtime, and keep the parser proof honest about the runtime that actually executed. **Actual:** correct version and honest prose, but an unmanaged engine outside the pack and an avoidable engine split. **Impact:** the flagship parser demonstration cannot be reproduced from the submitted evidence; the pack's own artifact audit describes a resolution that no step consumes; a second lane silently loses all receipts. **Smallest coherent fix:** resolve the engine from the pack's own `scratch/pdfjs-engine/` after a recorded `npm ci` (or copy the exact audited artifact bytes into the pack and hash them), use the `legacy` entrypoint so the demonstration is deterministic on the project Node 22 lane while keeping the modern-entrypoint failure receipt as the disclosed limitation of that build, and have the runner assert `process.version` and write receipts incrementally so a mid-run engine failure still leaves its evidence.

## Additional nonblocking observations

- `state: "aborted"` is returned without updating `this.state` at `openerController.mjs:124–131`, `:143–151` and `:186–191` (reproduced: `controllerStateField: "opened"`), so a UI reading controller state after supersession sees the previous operation's state.
- `reconcileBookmarksOnContentDrift` (`contractModel.mjs:382–412`) compares hashes case-sensitively while the protocol canonicalizes to lowercase; a stored uppercase hash can never reverify. Fail-safe, but inconsistent with R10's canonicalization requirement.
- `translateSplitCoordinates` requires the destination count only when supplied (R15) and does not verify `sourcePageEnd` against the root's own range ordering beyond length matching; harmless once R15 lands.
- `PARENT_DELETED` is reachable (id `R15-unknown-destination-count-resolves` → `deletedParentGuidanceReachable: "PARENT_DELETED"`) but has no permanent test, although "missing/deleted parent" was an assigned R9 case; `issue-to-test-map.json` records one M4-R12 entry, thin for four required items.
- The candidate DDL header still describes migration 0014 as "candidate (M3 skills evidence)"; 0014 is now shipped on accepted main.
- Report §1 "Baseline Starting Commit: `c28ab84…` (`origin/main`)" is no longer true; current main is `c32918b` (M3 merged).

## Verdict and next step

M4 preparation is **not** accepted: five P1 items (M4-R13–R17) remain, plus five P2 evidence and lifecycle items. R13/R14 are the priority — the current fix path can lose durable state silently and can publish a row asserting an obsolete content generation, and `docs/M4_CONDITIONAL_IMPLEMENTATION_PROMPT_2026-10-11.md:94` now propagates that repair-after-commit behaviour into the next implementation assignment, so it must be corrected before any production work inherits it.

Execute [one active model-neutral round-2 integration correction assignment](M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_R2_PROMPT_2026-10-11.md). Preserve every retained item above and all prior receipts. M4 stays evidence-only: no production migration registration, no dependency adoption, no shared-tracking edit and no owner approval is granted by publishing this review. M3-D1–D9 approval remains in force and is not revisited here. G1–G3 remain deferred/unexecuted/unverified. OD-1–OD-10 remain proposed; they will be presented to the owner only after preparation passes.
