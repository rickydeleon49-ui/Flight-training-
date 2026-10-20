# OFFLINE-03b implementation plan — the coupled practice-question writer (19 October 2026)

**Status: implementer's technical plan, revised against Codex plan review R1; findings 1–5 settled below. Not acceptance; implementation not started.** Uncommitted on `qwen/offline-03b`; publication only in a later authorized pass.

## 0. Receipt and setup

OFFLINE-03a is integrated: **PR #237 merged 2026-10-20T02:08:44Z, merge `6d909c5`, source `03d09b7`, CI run 39355980570 success**; Codex independently verified **166 focused**, **3,927 full passed / 6 skipped**, **26/26 schema-14 helper**, CI including native tests, fmt and Clippy. Installed/live-provider verification remains **UNVERIFIED**; historical evidence unchanged. Setup verified: only the assigned checkout was created — `/Users/rickymac/code/Flight-training-offline-03b` on `qwen/offline-03b` at `6d909c5`, clean; its `package.json`/`package-lock.json` (`6df0dcfa…`/`5086e547…`) are byte-identical to 02c-ui and its `node_modules` symlink reuses that shared tree (no install); all other checkouts preserved.

Outcome: manual practice-question authoring with truthful `gemini`/`import`/`manual` providers and per-question `user`/`instructor` origins, full history and frozen attempts preserved, controlled regeneration, private-by-default exports. The five approved defaults and revision 5 stand; migration 0016 stays byte-identical; no new dependency.

## 1. Storage: additive migration 0017 (findings 1–3)

One new add-only `0017_practice_authoring.sql`, proposed for Codex review before implementation; if any change is refused, 03b stops rather than faking the contract.

1. `ALTER TABLE practice_tests ADD COLUMN retired_json TEXT NOT NULL DEFAULT '[]'` — the current test's retirement list, ≤2,000 records `{itemId, kind:"question", reason:"deleted"|"corrected", textKey, terms}`, with 03a's shared normalization, `(kind,itemId,reason,textKey)` dedup and atomic overflow refusal. Mutable current metadata lives on the only mutable current practice row — never in append-only history.
2. `ALTER TABLE practice_test_items ADD COLUMN logical_id TEXT` and `ADD COLUMN replaces_id TEXT` (nullable, UUID-shape CHECK). Existing rows are **never updated**: both stay NULL for all pre-03b items and are written only on newly inserted version rows. Deterministic legacy fallback: `identity(item) = logical_id ?? item.id`, used by readers, retirement records and privacy checks. `replaces_id` is set only when a correction introduces a *new* identity replacing a different logical one; ordinary edit/correct keeps the identity and retires the earlier wording.
3. `CREATE TABLE practice_save_operations (operation_id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE, action TEXT NOT NULL CHECK (action IN ('create','edit','correct','regenerate','restore','remove')), payload_hash TEXT NOT NULL, result_json TEXT NOT NULL, applied_at TEXT NOT NULL)` — durable authoring receipts. Its only foreign key is the material, so established pruning of versions/items/attempts can never strand a receipt; `result_json`'s version id is a historical fact, not a live reference. Origins keep using 0016 `practice_item_origins`; previous states keep using 0016 `study_set_history (kind='practice')` with fresh UUID row ids — history is **not** overloaded as a receipt.

0017 consumers: the SQL file, `src/data/migrations.ts`, `src/data/migration-checksums.json`, `src-tauri/src/lib.rs`, `backup.rs` (reference-schema chain 16→17 + schema-17 semantics), `practiceStateValidation.ts` (`newest >= 17` twin), restore validators both engines, and `structuredImportTransaction.ts`/`study_packet.rs` (§8).

## 2. One exact-key snapshot contract (finding 1)

`PracticeSnapshot` — exact keys, validated identically in TS, native and backup/restore, and stored as the `previous_json` of every `kind='practice'` history row:

`{ schemaVersion:1, versionId, versionNumber, title, provider, model, savedAt, questions:[{question, options, correctIndex, explanation, sourcePage, identity, origin?, replaces?}], retired:[records] }`

- Carries the **actual** wording, options, answer indexes and explanations — never only digests — plus origins, identities, replaces, the full retirement list, and the current concurrency identity (`versionId`/`versionNumber`/`savedAt`): enough to reconstruct the exact previous state.
- `identity`/`replaces`/`retired` are separately validated editor metadata and **never enter `content_hash`** (§5). `provider ∈ {gemini, import, manual}`; the history `provider` column equals the snapshot provider.
- Save/remove wire: `{operationId, sourceMaterialId, reason, expected: PracticeSnapshot|null, next: PracticeSnapshot|null}`, replacing today's `{sourceMaterialId,title,questions,model}`. Stale `expected` refuses as `STALE_CONTENT`. The hard-coded `'gemini'` in both engine transactions is deleted; every caller passes its provider explicitly; unknown values refuse; origins are never dropped; the `card_versions.provider` CHECK is untouched.
- **Restore** first writes the *current* state to history with reason `restore`, then inserts the chosen snapshot as a new active version. Resulting `retired_json` = union of current and restored records, deduplicated, ≤2,000 with atomic overflow refusal; a restored retired wording is her explicit bring-back and every record is retained — a restore never silently erases other deletion/correction protection.

## 3. Receipts, staleness, idempotence (finding 2)

One `BEGIN IMMEDIATE`, both engines: first look up `practice_save_operations` by `operation_id`. **Absent** → check `expected`, then apply: insert receipt → write history row (whole previous snapshot; none for `create`) → deactivate old version → insert version/items with `logical_id`/`replaces_id` and `practice_item_origins` rows → upsert the `practice_tests` mirror with `retired_json` → attempt gate (§7) → COMMIT. **Present** → require `payload_hash` (SHA-256 of `canonical_json` of the exact whole operation) **and** `material_id`/`action` to match: full match returns the stored result as `already_saved` with no second version, item id, history row or receipt — even if later operations changed the current state; any mismatch refuses as `CONFLICT`. Presence alone is never accepted, including create (`expected=null`) and remove (`next=null`). The receipt commits with the mutation, so an injected failure rolls back receipt, version advancement, items, origins, history and attempt changes together.

Reason→history mapping: `create`→none, `edit`→`edit`, `correct`→`correct`, `regenerate`→`regenerate`, `restore`→`restore`, `remove`→`delete`; `import` remains for a future validated import-replacement. Typed outcomes: `saved | already_saved`; errors `STALE_CONTENT | CONFLICT | ATTEMPT_ACTIVE | INVALID_ARGUMENT`. Lifecycle: material deletion cascades receipts; current-test removal and `erasePracticeHistoryAtomically` retain them (they guard save retries, not attempt history); erased *attempt* receipts keep their existing `is_erased` behavior in `practice_session_operations`.

## 4. Identity and instructor-origin privacy (finding 3)

Historical rows are never re-minted; identities flow only through newly inserted items and the §1 fallback. The save transaction compares `expected` and `next` by identity: any identity whose `expected` origin is `instructor` must keep `instructor` in `next` unless the whole question is deliberately deleted (recorded `deleted`) — rewording an instructor's correction keeps `instructor` (the accepted 03a rule). Restore reads origins from the validated envelope; regeneration "Keep my items" preserves them exactly and "Replace everything" retires rather than relabels. Refused before any write, with a test per path (direct IPC, later edit, restore, regeneration): an origin downgrade or drop; one `identity` used twice in a snapshot; a `replaces_id` not owned by this material; an origin for an identity absent from `next`.

## 5. Hash parity

`origin` joins the canonical question only when present (the `cardIdentity.ts` rule; native `CanonicalQuestion` gains `Option<&str> origin`, `skip_serializing_if`, declared between `options` and `question`); `identity`/`replaces`/`retired`/`schemaVersion` never join. Legacy five-field vectors hash byte-identically; independent shared golden vectors (legacy + origin-bearing) run against TS, native save/conversion and backup recomputation; side-table tampering and current/version mismatch are rejected on restore.

## 6. Checkpoint and acknowledgement (finding 4)

`reviewedSaveCheckpoint.ts` generalizes backward-compatibly to a discriminated union — `{kind:"study-set", operationId, expected:StoredSetRow, next:NextStudySet}` or `{kind:"practice", operationId, expected:PracticeSnapshot|null, next:PracticeSnapshot|null}` — under the same `her-flight-deck.reviewed-regeneration.<jobId>` keys. Existing kind-less study-set records parse as `kind:"study-set"` exactly as today; new writes include `kind`; practice `expected` may be null for a first create. The reader checks discriminator and shape; the save transaction re-validates everything. Provider ownership is unchanged: remembered before submission; cleared only by a true acknowledgement or a resolved-false with confirmed-absent read-back; retained on rejection, a present entry or an unreadable journal. After restart the job re-sends the identical operation and §3's receipt answers `already_saved` — no duplicate history or ids; the provider stays decoupled from any dialog.

## 7. Attempts and hidden answers

Edit/restore operations and opening a regeneration review require **no in-progress attempt**: the panel disables entry and offers the existing deliberate *Abandon attempt* flow; both backends refuse with `ATTEMPT_ACTIVE` if one exists against `expected`. Attempts keep their frozen version's exact content and origins — no historical `practice_test_items` row is ever written — and completed-attempt review is unchanged; no protected answers reach authoring surfaces. A provider regeneration that needs no review keeps today's abandon-on-replace.

## 8. Regeneration, authoring UI, exports, import/removal (findings 5, 8–9)

- **Regeneration review:** `needsRegenerationReview` extends to `kind === "practice-test"` on the existing `RegenerationReviewDialog` pattern: deterministic stem-based `textKey` exact-hold, Jaccard ≥0.6 near-match requiring her choice, full proposed text/options/answer/explanation beside the earlier wording, Keep-my-items default, explicit bring-back (record retained), cancel writes nothing, no card coercion, no personal history to providers, atomic 2,000-overflow refusal with draft retention.
- **Authoring UI:** one new `<dialog>`, `PracticeTestEditing`, reusing `useModalDialog`, existing inputs and `StudySetEditing` patterns: create where no test exists (`create`, `expected:null`); add/edit/correct/delete questions and options; bounded validated `correctIndex`; optional explanation (≤5,000) and page (1–1,000); sticky instructor marking (§4); synchronous locks, drafts survive failures, Cancel writes nothing, a stale dialog cannot overwrite; "Previous versions" over `kind='practice'` history with the §2 restore.
- **Exports/search:** `provenanceNote` labels a `manual` test "written by hand in Her Flight Deck…", never blanket-AI; gemini/import tests containing any per-question origin get the handwritten supplement; instructor-corrected questions are excluded from handouts and packets by default, a deliberate include switch applies before serialization, and handouts label each included item; packet v1 stays strict with disclosed label loss, no v2; saved-content search indexes and snippets question stems only — never options, `correctIndex` or explanations.
- **Import parity (finding 5):** the packet create-new path bypasses the save API, so `structuredImportTransaction.ts` and `study_packet.rs` join the inventory explicitly: `provider='import'` (already enforced) and their existing `operationId`/`contentHash` idempotence are kept; inserts add `retired_json='[]'` and NULL identity columns (fallback identities), and the §5 hash is unchanged; packet JSON gains no origin/identity fields.
- **Removal:** current-test removal first writes the full snapshot to history (`delete`) through a `remove` receipt, then deactivates and prunes as today, retaining completed attempts; material deletion cascades history, origins and receipts.

## 9. Validation depth and backup compatibility (finding 5, contract 10)

Both state/backup validators enforce consistency, not column registration: every practice `previous_json` parses against §2; origins and receipts join to real rows; identities are unique per snapshot and owned by one material; `replaces_id` resolves within that material; `retired_json` meets shape/bounds; the active version ↔ `practice_tests` mirror agrees. Populated schema-16 backups migrate to 17 and round-trip provider, origins, identities, retirement, history, receipts and attempts; earlier supported backups still migrate; shipped SQL/checksums byte-identical; bundle id unchanged; extraction/search dormant; 03c deferred; scheduler work untouched; installed/performance gates stay open.

## 10. Acceptance matrix

| # | Contract → decision | Evidence |
| --- | --- | --- |
| 1 | Full snapshot; restore preserves replaced state, unions retirement (§2) | envelope + restore tests, both engines |
| 2 | Explicit provider/origin, no fallback relabel, card CHECK untouched | decode/caller sweep |
| 3 | Receipt→history→version→origins→mirror atomically; all roll back | injected-failure groups |
| 4 | Receipt-bound `already_saved`/`CONFLICT`/`STALE_CONTENT`, restart re-send (§3) | retry/receipt lifecycle tests |
| 5 | Fallback identity, immutable old rows, downgrade refusals (§4) | ownership + per-path privacy tests |
| 6 | Byte-stable legacy hashes; origin-only canonical growth (§5) | shared golden vectors ×3, tamper tests |
| 7 | `ATTEMPT_ACTIVE` gate; frozen attempts byte-unchanged (§7) | attempt-protection group |
| 8 | hold-back/near-match/keep/replace/cancel/bring-back/overflow (§8) | regeneration-review group |
| 9 | Default exclusion, truthful labels, packet v1 strict, stem-only search (§8) | export-privacy group |
| 10 | Import parity + schema-17 semantic validation and round-trips (§8–9) | import-parity, backup-schema17 groups |

## 11. Work breakdown, tests, verification

One coherent PR on `qwen/offline-03b`; two bounded rounds. **Round 1 — persistence, no writer exposed:** 0017 + registrations; shared `PracticeSnapshot` codec; receipts table; extended save/remove/restore transactions in both engines; identity/replaces + refusal rules; hash parity + golden vectors; truthful readers (`documentRepository.mapPracticeTest`, `practiceSessionRepository` version/item/history); schema-17 semantic validators; import-path parity. **Round 2 — coupled UX:** panel/`MaterialDetail` entries + abandon gate; `PracticeTestEditing`; regeneration review through `GeminiJobs` + the union checkpoint; export labels/switch; Previous-versions UI; trackers.

Test groups (real behavior, not code-mirrors): `practice-snapshot-envelope`, `practice-authoring-transaction` (node-sqlite + sql.js parity), `practice-receipt-idempotence`, `practice-hash-parity`, `practice-identity-privacy`, `practice-attempt-protection`, `practice-regeneration-review`, `practice-export-privacy`, `practice-import-parity`, `practice-backup-schema17`; scoped native `cargo test`, strict Clippy/fmt and cargo-lock under the SDK26.5 precedent. Node 22 focused suites → typecheck/build → one sequential full frontend matrix; failed/intermittent results stay visible; no timeout or suppression edits; no live Gemini, real profile/key, installer or release activity; Qwen never merges.

## 12. Remaining risks

- Refusing any single 0017 change reshapes §2–§3; there is no fallback that fakes the contract.
- Native `CanonicalQuestion` declaration order must keep `origin` between `options` and `question`; golden vectors pin it.
- Provider abandon-on-replace versus the manual `ATTEMPT_ACTIVE` gate are deliberately different; tests assert both separately.
- The union-at-restore rule can bring heavily restored sets nearer 2,000; only the accepted overflow refusal applies.
- Kind-less legacy checkpoint parsing must not loosen study-set validation; regression tests both shapes.

## 13. Proposed first bounded assignment (after plan acceptance)

Round 1 only, in this checkout: 0017 + every §1 consumer; the `PracticeSnapshot` codec and validators; `practice_save_operations` and the receipt-first transaction order in `practiceSessionTransaction.ts`, both drivers, `tauriDb.ts`, `practice_sessions.rs`, `study_packet.rs` and `structuredImportTransaction.ts`; identity/replaces with fallback and refusals; origins through `practice_item_origins`; the §5 hash rule + shared vectors; truthful readers; schema-17 semantic validation in `practiceStateValidation.ts` and `backup.rs`. No UI writer; then stop for Codex review before Round 2.
