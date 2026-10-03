# Structured study import: implementation handoff (proposed, corrected)

Prepared by Claude on the Mac, 3 October 2026, on branch `codex/structured-study-import-contract` (base `8fb3b7f`), alongside the [contract](STRUCTURED_STUDY_IMPORT_CONTRACT_2026-10-03.md). **Planning only.** Nothing here may start until its gates in §6 clear. No dependency, migration or behavior was changed by this preparation.

**Corrected after [Codex's review](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/STRUCTURED_STUDY_IMPORT_REVIEW_2026-10-03.md) (R1–R4) and [re-review](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/STRUCTURED_STUDY_IMPORT_REREVIEW_2026-10-03.md): R1–R5 independently closed; [preparation accepted](STRUCTURED_STUDY_IMPORT_ACCEPTANCE_2026-10-03.md).** The correction maps are in contract §8 and §8.1.

- **R1:** the APIs below carry the corrected diagnostic guarantee.
- **R2:** they carry preview data.
- **R3:** they use import DTOs that compile against the unchanged domain types.
- **R4:** the gates in §1, §6 and §7 now agree with the [adoption plan](OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md) and the [open-source Mac handoff](OPEN_SOURCE_MAC_HANDOFF.md).

## 1. Recommendation

Implement in **three separately reviewed slices**. The smallest production slice is **A: the validator and the read-only packet reader**. It adds Zod and a pure module plus a read-only native command, and changes no stored data and no screen. **B** adds the atomic save and the user-visible flow; it is the first slice users would notice. **C**, Markdown rendering with react-markdown, is optional and can be skipped: the current plain-text renderer is already safe (contract §4.1).

| Slice | Adds | Data risk | Needs |
| --- | --- | --- | --- |
| A | `zod@4.6.5`, the packet validator, `pick_study_packet` | none (no writes) | the applicable foundation/adoption gates (§6), **or** an explicit documented owner exception for this source-only slice; Codex acceptance of this contract; dependency re-check |
| B | `save_structured_study_import`, adapters, provenance type, import dialog, labels | low (create-only, single transaction, no migration) | A merged; accepted, published A2 conventions; M2 real-user check-in with scoped approval; owner decisions D1–D9 (proposals today) |
| C | `react-markdown@10.1.0`, `Object.hasOwn` shim, guarded renderer | none (display only) | B merged; adoption gates as for A; release only after installed macOS 12.0–12.2 and current-macOS checks |

## 2. Slices

### Slice A: validator and packet reader

**Files** (proposed):

| File | Change |
| --- | --- |
| `package.json`, `package-lock.json` | add `"zod": "4.6.5"` (exact). Nothing else. |
| `src/logic/studyPacket/limits.ts` | `FORMAT`, `FORMAT_VERSION`, `LIMITS` exactly as contract §2.2 and §2.11 |
| `src/logic/studyPacket/scan.ts` | strict bounded JSON scanner (contract §2.11); no `JSON.parse` |
| `src/logic/studyPacket/schema.ts` | Zod schema with normalization; `z.config({ jitless: true })` at module top; never import `zod/compile` |
| `src/logic/studyPacket/validate.ts` | `validateStudyPacket`, semantic checks, error mapping without echo, preview model, mapping to `AiStudySet`/`PracticeTest` |
| `src/logic/studyPacket/*.test.ts` | the fixture matrix (§4) |
| `src/testing/fixtures/study-packets/` | copies of the contract fixtures and `expected-outcomes.json` |
| `src-tauri/src/study_packet.rs` | `pick_study_packet` (below) and its unit tests |
| `src-tauri/src/lib.rs` | register the command |
| `src/services/studyPackets.ts` | typed `invoke` wrapper; `DesktopOnlyError` outside Tauri, like `documents.ts` |

The corrected prototype in `docs/evidence/structured-study-import-contract-2026-10-03/prototype-corrected/` (`validator.mjs.txt`, with the unchanged helpers in `prototype/`) is the reference behavior. The original `prototype/validator.mjs.txt` is kept as reviewed history and is superseded. Port it to TypeScript; do not paste it unreviewed.

**APIs** (the compiling definitions are in `prototype-corrected/dto-check-import-dto.ts.txt`; summary):

```ts
// R3: import DTOs omit and redefine provider; the stored domain types stay unchanged until Slice B.
type StoredOnly = "sourceMaterialId" | "provider" | "generatedAt" | "updatedAt";
type ImportedStudySetDraft = Omit<AiStudySet, StoredOnly> & { provider: "import"; model: "" };
type ImportedPracticeTestDraft = Omit<PracticeTest, StoredOnly> & { provider: "import"; model: "" };
type ImportPayload = { material: Pick<StudyMaterial, "title">;   // all other material fields: fixed Slice B native defaults
                       studySet: ImportedStudySetDraft | null; practiceTest: ImportedPracticeTestDraft | null };
// R2: in-memory preview data, never persisted.
type PacketPreview = { title: string; counts: {…}; createsStudySet: boolean; createsPracticeTest: boolean;
                       warnings: { code: PacketWarningCode; message: string }[];
                       data: PacketPreviewData;          // source claims | null, guide, cards/questions with index, id, sourceRefs[]
                       discardedOnSave: { sourceClaims: ("generator" | "createdAt" | "note")[]; sourceRefs: number; exportIds: number; choiceIds: number } };
// R1: the diagnostic boundary.
type PacketError = { code: PacketErrorCode; message: string;   // fixed
                     path: string;                              // "$" + ".<contract-owned name>" | ".<field>" | "[<int>]"
                     limit?: number; offset?: number; index?: number; firstIndex?: number; supported?: [1];
                     field?: ContractField | DirectiveField | LegacyAnswerField };   // fixed allowlists only
type PacketValidationResult =
  | { ok: true; stage: "preview"; preview: PacketPreview; payload: ImportPayload }
  | { ok: false; stage: "bytes" | "scan" | "gate" | "schema" | "semantic" | "internal"; errors: PacketError[]; omittedErrors: number };
function validatePacketText(text: string, opts: { bomRemoved: boolean }): PacketValidationResult; // re-derives byte size; trusts no claimed length
function validatePacketBytes(bytes: Uint8Array): PacketValidationResult;                        // tests and browser adapter
function canonicalPersistenceJson(payload: ImportPayload): string;  // contentHash = SHA-256(UTF-8(this)), contract §3.5
```

```rust
#[tauri::command] async fn pick_study_packet(app: AppHandle) -> Result<Option<PickedPacket>, String>
// PickedPacket { file_name, byte_length (original bytes), sha256 (original bytes, including any BOM), text (BOM stripped), bom_removed }
```

- The native dialog opens in Rust, filtered to `.json`, so the webview never supplies a path.
- Size is checked from metadata (≤ 4,194,304), then at most limit + 1 bytes are read.
- UTF-16 BOMs are rejected; strict `std::str::from_utf8`; one UTF-8 BOM is stripped.
- `Ok(None)` on cancel. **No writes and no copy into app storage.**
- Error strings are fixed text; they never include file content or the file path.
- The original-file `sha256` is for display only. It is not the persistence `contentHash` (contract §3.5).

**Error states shown to the user:** every code in contract §2.12, as path plus message, capped at 50, plus "file too large", "not UTF-8" and "could not read".

**Acceptance:**

- every fixture and generated case reproduces its expected outcome, including the preview assertions on fixtures 01, 02, 04 and 54–58
- the 41 permanent regressions (`R1:`, `R2:`, `R3:`, `R5:` and the two LF controls) pass
- the 22 mutants in `results-r5/mutation-results.json` are ported as targeted tests and behave as recorded: 19 caught, plus 3 single-layer privacy defects (M10, M12a, M12b) absorbed by the other layer
  - *Clarified 3 October after the re-review:* the earlier summary of the R1–R4 run said 15 caught and 4 absorbed. The recorded JSON shows 16 caught and 3 absorbed.
- the DTOs and real outputs typecheck against the unchanged domain types
- no `Function` constructor use with `jitless`
- no network
- `tsc`, focused Vitest and focused `cargo test` pass
- the lockfile adds only `zod`
- a third-party notice entry exists for Zod (§5)

### Slice B: atomic save and the import flow

**Files** (proposed):

| File | Change |
| --- | --- |
| `src-tauri/src/study_packet.rs` | `save_structured_study_import(op)` with a pinned rusqlite connection, `busy_timeout(5 s)` and `BEGIN IMMEDIATE`, following `save_split_materials` (`documents.rs:1220`) and `save_debrief_operation_at` (`debrief.rs:157`). It inserts the material, then the `ai_study_sets` row if present, then the `practice_tests` row if present, all with `provider = 'import'` and `model = ''`. One commit; any error rolls back. |
| `src/data/db.ts` | `saveStructuredImportAtomically?(op): Promise<"saved" \| "already_saved">` |
| `src/data/tauriDb.ts`, `src/data/sqlJsDb.ts` | desktop: invoke the command. sql.js: the same statements in one `BEGIN IMMEDIATE`…`COMMIT` on its single connection. |
| `src/domain/types.ts` | `provider: "gemini" \| "import"` on `AiStudySet` and `PracticeTest` |
| `src/data/repositories/documentRepository.ts` | mappers read `provider` through an allowlist, falling back to `"gemini"`; `importStudyPacket(op)` calls the atomic operation and **refuses** if the adapter lacks it (no non-atomic fallback). Existing `saveAiStudySet`/`savePracticeTest` keep writing `'gemini'`, unchanged. |
| `src/pages/StudyLibrary/ImportStudyPacketDialog.tsx` | pick → preview → confirm, using the existing accessible dialog with the A3 fallback |
| `src/pages/StudyLibrary/StudyLibrary.tsx` | toolbar entry "Import study packet…" (D1) |
| `src/pages/StudyLibrary/MaterialDetail.tsx` | for `provider === "import"`: card title "Imported study packet", imported-content disclaimer (contract §3.6), no Gemini empty-state notice for imported content; the regeneration confirmation states it replaces the imported guide/test |

**Operation:**

```ts
{ materialId /* minted once per preview */, contentHash, material: { title }, studySet | null, practiceTest | null }
```

The native side re-checks invariants:

- counts and lengths within the contract
- `correctIndex` inside `options`
- at least 2 options
- non-empty required text
- `sourcePage` null

If the material ID already exists, the native side compares its stored study-set/test JSON with the payload. Equal gives `already_saved`; different gives a conflict (D7).

**Error states:**

| Situation | Message | Data |
| --- | --- | --- |
| Not imported | "Nothing was changed" + Try again | rolled back |
| Busy after 3 retries | lock message | unchanged |
| Outcome unknown | Try again gives `already_saved` | one copy |
| Conflict | not retryable | unchanged |
| Saved, refresh failed | stale-screen message | saved |

**Acceptance:**

- the test matrix (§4) passes on real sql.js and real temporary SQLite
- cancellation at every pre-commit step writes nothing
- an injected failure at each statement leaves prior data byte-identical
- backup → restore keeps the imported material, guide, test and provider
- an older-schema-compatible restore is documented
- the existing Gemini flows, PDF Open, split and backup tests are unchanged and passing
- the full TypeScript/Rust matrix passes once after corrections

### Slice C: guarded Markdown rendering (optional)

**Files** (proposed):

| File | Change |
| --- | --- |
| `package.json`, `package-lock.json` | add `"react-markdown": "10.1.0"` (exact) |
| `src/lib/compat.ts` | narrow `Object.hasOwn` shim (`Object.prototype.hasOwnProperty.call(Object(o), k)`), installed in `src/main.tsx` before rendering. Follow the A3 pattern (`legacyWebKitStartup.test.ts`). |
| `src/components/GuideMarkdown.tsx` | the configuration in contract §4.3: `skipHtml` false, allowed elements, `unwrapDisallowed`, `displayUrl`, our `remarkDepthGuard` (64), text-only links, omitted images, `h5`/`h6` headings; memoized; wrapped in an error boundary that falls back to the current `<p class="ai-copy">` |
| `MaterialDetail.tsx` | use `GuideMarkdown` for `summary` and section `body` when `provider === "import"` (D9); everything else stays plain text |

**Acceptance:**

- the hostile, nesting and URL cases in `results/render-results.json` pass as component tests
- rendering with `Object.hasOwn`, `structuredClone`, `Array.prototype.at` and `findLast` removed succeeds through the shim
- no `<a>` or `<img>` in the output
- 0 fetch calls
- **installed** checks: macOS 12.0–12.2 (shim path), current macOS, VoiceOver reading, parse timing at the 20,000-code-point limit, no CSP violation in the console

## 3. Out of scope for every slice

- MiniSearch (no-go)
- conditional virtualization
- the later embedded PDF viewer
- FSRS or any scheduler
- durable attempts or content versions (M2)
- replacing existing content (D2)
- `remark-gfm` (D10)
- opening links externally (D11)
- Claude, Codex or other provider APIs
- automatic uploads
- changes to Gemini requests, prompts or keys
- the database driver, backup container format, managed-document ownership, minimum OS, PDF engine, version or bundle identity

## 4. Test matrix

| # | Case | Slice | Kind |
| --- | --- | --- | --- |
| 1 | All 56 committed fixtures match `expected-outcomes.json` | A | unit |
| 2 | Generated boundaries below, at and above every limit (file bytes, depth for arrays **and** objects, keys, key length, digits, values, code points including NFC, every array, ID lengths) | A | unit |
| 3 | Encoding: empty, UTF-16 BOM, invalid and overlong UTF-8, UTF-8 BOM | A | Rust + unit |
| 4 | Diagnostic boundary (R1): whole failure objects contain only allowlisted properties; contract-owned path names only; unknown keys never named; duplicates by `index`/`firstIndex`; ASCII private and runtime-assembled credential-shaped sentinels never returned at any stage; `internal_error` for exceptions; cap 50 plus a count | A | unit |
| 4a | Preview data (R2): normalized source claims (each claim kind alone flagged; empty source not a claim), per-item references in order, export IDs, `discardedOnSave`; none of these in the payload; `sourcePage` null | A | unit |
| 4b | Boundary and types (R3): text entry re-derives the byte size (BOM, astral text); canonical content JSON ignores key order and preview-only values; DTOs compile against the unchanged domain types | A | unit + typecheck |
| 4c | Guide source notes (R5): notes without a substantive guide or card are rejected at `$.guide.sourceNotes` (questions-only, empty or blank summary/sections, omitted versus empty arrays), with no preview or payload and no echo; notes with cards, a guide or both are saved exactly as normalized and change the canonical content; blank notes are absent; standalone notes are `packet_empty` | A | unit |
| 5 | Prototype keys never alter object prototypes; duplicate keys, `1.0`, `\u0000` and lone surrogates are refused before Zod | A | unit |
| 6 | `jitless`: `Function` constructor never called | A | unit |
| 7 | Bounded read: oversize is refused before reading; a file that grows during the read is refused | A | Rust |
| 8 | Picker cancel returns `None`; nothing written anywhere | A | Rust |
| 9 | Preview has no repository or write access (spy) | B | component |
| 10 | Confirm creates exactly one material, study set and test, with counts equal to the preview; unrelated rows identical | B | sql.js + Rust SQLite |
| 11 | Injected failure after each insert (for example a temporary trigger) rolls back; retry succeeds once | B | sql.js + Rust SQLite |
| 12 | Busy lock: bounded retry; gives up with data unchanged | B | Rust SQLite |
| 13 | Same operation retried: `already_saved`; different content with the same ID: conflict | B | Rust SQLite |
| 14 | Double click: one invoke | B | component |
| 15 | Refresh failure after commit: saved message, no rollback | B | component |
| 16 | Guide-only packet: no test card; the "no practice test" warning was shown | B | component |
| 17 | `sourcePage` null for imports; the "Source p." badge never shows | B | component |
| 18 | Provider allowlist: `"import"` round-trips; unknown values become `"gemini"`; malformed JSON rows behave as today | B | repository |
| 19 | Backup → restore keeps imported content and provider; a newer schema is still rejected | B | Rust backup tests |
| 20 | Existing Gemini save paths still write `'gemini'`; file-based generation request bodies unchanged | B | existing + new |
| 21 | Imported material with a later-attached file: the regenerate confirmation mentions replacing imported content | B | component |
| 22 | Hostile Markdown, URL policy, images omitted, nesting fallback, error-boundary fallback | C | component |
| 23 | Legacy WebKit capability removal + shim | C | startup test |
| 24 | Installed: import → offline study → restart → backup/restore on the Mac test account | B/C | installed (runbook) |

## 5. Rollback and licensing

**Rollback:**

- **A** is purely additive; reverting it removes the module, the command and `zod`.
- **B** adds no migration. Reverting removes the flow and the command. Imported rows stay as ordinary study rows, which older code shows as Gemini-labelled (the disclosed proposed tradeoff D3, contract §3.6, which needs an owner decision before B); content is not lost.
- **C** reverts to plain text.
- Each slice is its own PR with its own exact-head CI.

**Licensing:**

- Zod (MIT, no dependencies) and react-markdown (MIT; its tree adds 74 more runtime packages: 73 MIT and 1 ISC) require their copyright and permission notices in distributed builds.
- **The repository has no third-party notices file today.** Slice A must add one, for example `THIRD_PARTY_NOTICES.md`, generated from the lockfile for the shipped dependencies, and say where it is bundled.
- Re-check the exact versions, licenses and transitive packages at implementation time; the 3 October inventory is in `results/dependency-inventory.tsv`.

## 6. Gates: where each applies

The gate stages are kept separate. [Contract preparation is independently accepted](STRUCTURED_STUDY_IMPORT_ACCEPTANCE_2026-10-03.md); production and release gates remain pending. Nothing here grants an exception.

| Stage | What it covers | Required before it | State on 3 October |
| --- | --- | --- | --- |
| **Preparation** | contract, schema, fixtures, disposable prototype, this handoff | nothing further; authorized now | [Preparation accepted; R1–R5 closed](STRUCTURED_STUDY_IMPORT_ACCEPTANCE_2026-10-03.md) |
| **Implementation of Slice A** (production source: Zod, validator, read-only reader) | | Codex acceptance of the contract **and** the applicable foundation/adoption gates. Per the [adoption plan](OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md) (status section) that means the foundation gates, independent review and the relevant M2 user check-in. Per the [open-source Mac handoff](OPEN_SOURCE_MAC_HANDOFF.md) it means the foundation corrections (including A2) and the source/installed evidence gaps. **Or** an explicit, documented owner exception for a narrower source-only Slice A, recorded in the repository with its scope. | **Not met.** A2 is unpublished; there are no installed results; the M2 check-in has not been held; **no exception exists** |
| **Implementation of Slice B** | | everything for A, plus accepted, **published** A2 conventions and the M2 real-user check-in with scoped approval; owner decisions on D1–D9, notably D3 | **Not met** |
| **Implementation of Slice C** (optional) | | as for A, applied to react-markdown, plus B merged | **Not met** |
| **Merge** (any slice) | | Codex's independent acceptance of the exact head; a passing exact-head **required check**, which today is the single Ubuntu job `Tests, types, and the data-safety guards` (`.github/workflows/checks.yml`: TypeScript tests, types, Rust format/lint/tests and data-safety guards on `ubuntu-latest`); an updated `MAC_PARITY_CHECKLIST.md`. That Linux check is **not** Mac or Windows evidence. | n/a |
| **Platform builds and compatibility** (before release; recommended before merging B or C) | | Mac and Windows packaging through `build-desktop.yml`, which today is a manually dispatched `macos-15`/Windows build, not a required check; a macOS 12.0–12.2 compatibility check for C's shim. This handoff does not change workflows. | not run for this preparation |
| **Release** (any build containing B or C) | | installed Mac testing on a standard test account under the [installed-readiness runbook](MAC_INSTALLED_READINESS_PREPARATION_2026-10-03.md); early macOS 12.0–12.2 for C's `Object.hasOwn` shim; Windows installed-app behavior; the owner's account and signing decisions; existing release holds respected | **Unverified**; owner actions pending |

## 7. Copy-ready future implementation prompt (do not start until its gates clear)

```text
Continue Her Flight Deck in the Mac clone. Start only when ALL of these hold, and record the evidence for each:
(1) the corrected structured study-import contract (docs/STRUCTURED_STUDY_IMPORT_CONTRACT_2026-10-03.md) has been
accepted by Codex; (2) for ANY slice, the applicable foundation/adoption gates in docs/OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md
and docs/OPEN_SOURCE_MAC_HANDOFF.md are satisfied (foundation corrections including published, accepted A2; the
source/installed evidence gaps; independent review; the relevant M2 user check-in), OR the owner has granted an explicit,
documented exception for a narrower source-only slice A, recorded in the repository with its scope (an exception for A
never covers B or C); (3) for slice B, additionally, accepted published A2 conventions, the M2 real-user check-in note
with scoped approval, and owner decisions on D1-D9 (including D3, the older-binary provenance tradeoff); (4) the
checkout is clean and synchronized with main. If a gate is not met, stop and report which; do not proceed on a proposal. Create one branch per slice from updated main. Implement exactly one slice per branch, in
order A -> B -> (optional) C, and stop for Codex review after each.

Ground truth: the contract (format hfd-study-packet v1, limits, pipeline, error codes, mapping), the JSON Schema
docs/contracts/hfd-study-packet-v1.schema.json, the fixtures and expected-outcomes.json, and the reference prototype in
docs/evidence/structured-study-import-contract-2026-10-03/prototype-corrected/ (with unchanged helpers in prototype/),
the permanent regressions run-regressions.mjs.txt and the DTOs dto-check-import-dto.ts.txt. Port behavior; do not paste the prototype
unreviewed. Re-check zod 4.6.5 / react-markdown 10.1.0 versions, licenses and transitive packages from the npm registry
first; record the date; if a newer version is used, re-run the prototype evidence against it.

Slice A (validator + read-only reader): add zod exactly, set z.config({ jitless: true }) before any schema, never
import zod/compile. Implement the strict bounded scanner (no JSON.parse), the version gate, the Zod schema with
deterministic normalization, semantic checks, the diagnostic boundary (contract-owned path names only, unknown keys
never named, duplicates by index/firstIndex, fixed allowlists for field, internal_error for exceptions), the in-memory
preview data (normalized source claims, per-item references, export IDs, discardedOnSave) and the separate lossy
persistence payload typed as the import DTOs (provider "import" redefined, model "", sourcePage null, material {title}
only; do NOT widen the stored domain types in A), plus canonicalPersistenceJson. Add the Rust pick_study_packet command:
native dialog, metadata size check before reading, bounded read, original-byte SHA-256, UTF-16 BOM rejection, strict
UTF-8, BOM strip with bomRemoved, no writes, no copy into app storage; the TypeScript validatePacketText re-derives the
byte size from the text. Enforce the R5 rule: non-empty guide.sourceNotes need a substantive guide or a flashcard,
else source_notes_without_study_set at $.guide.sourceNotes. Add a third-party notices file. Tests: handoff test-matrix
rows 1-8 with 4a/4b/4c, the 41 permanent regressions, and the 22 recorded mutants as targeted tests (19 caught,
3 absorbed by the second privacy layer). Exact-head CI means the required Ubuntu check; record Mac/Windows packaging
and installed results separately.

Slice B (atomic save + flow): add save_structured_study_import as one pinned native SQLite transaction (pattern:
save_split_materials / save_debrief_operation), the sql.js equivalent and SqlDatabase.saveStructuredImportAtomically.
Refuse to import if the atomic operation is unavailable. The native save supplies the fixed material defaults
(contract §2.13) and checks contentHash for idempotency. Widen provider to "gemini" | "import" with an allowlist mapper;
leave existing Gemini writes untouched. Create-new-material only (no replacement). Add the import dialog (pick ->
bounded read -> preview with counts, warnings and an explicit "no practice test" statement -> confirm -> save), the
synchronous double-click lock, idempotent retry by pre-minted material id, and imported-content labels and disclaimer.
Tests: rows 9-21 on real sql.js and real temporary SQLite, including injected mid-transaction failures and backup ->
restore round trips. Nothing is written during preview or on cancel.

Slice C (optional rendering): add react-markdown exactly, an Object.hasOwn shim installed before rendering (A3
pattern), the guarded GuideMarkdown component (skipHtml false, allowed elements, unwrapDisallowed, text-only links,
omitted images, our iterative depth guard at 64, error-boundary fallback to the existing plain-text renderer,
memoized), used only for imported guides' summary and section bodies. Tests: rows 22-23.

Always preserve: current Gemini behavior, prompts, keys and request bodies; existing study content; backup integrity
and the archive format; the database driver; managed-document ownership; minimum macOS 12.0; native PDF Open; Mac and
Windows support; version and bundle identity; release holds. No migration, no Claude/Codex API, no automatic upload,
no network during import, no execution of imported content. Keep MiniSearch, virtualization, the embedded PDF viewer
and FSRS out of scope. Do not mark installed checks passed; installed Mac (including macOS 12.0-12.2 for slice C) and
Windows app behavior remain UNVERIFIED until run under the installed-readiness runbook.

Run focused tests while developing, then one complete local TypeScript/Rust matrix after corrections. Leave changes
uncommitted for Codex review. Final handoff: branch/base, file inventory with hashes, the decisions used (D1-D12),
test commands with counts and exit codes, failing attempts, the gate evidence or owner exception relied on, and the
remaining merge/release gates.
```
