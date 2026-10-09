# M2 split-source lineage — production implementation

You are the implementation model for Her Flight Deck, a Tauri 2 Mac app with a React/TypeScript frontend and SQLite/Rust storage. Implement the accepted split-lineage scope as production code, prove it, then stop for independent source review. Work precisely and keep pace.

## 1. Authority and documents

The scope and proof are accepted (`M2_SPLIT_LINEAGE_SCOPE_ACCEPTANCE_2026-10-08.md`). The owner approved SL-D1 through SL-D8 ("i approve SL-D1 through SL-D8"), recorded in `OWNER_APPROVAL.md`. Don't ask for approval again; record the approval in your evidence before any code.

Read these in full from current origin/main with `git show`, or from the folder the owner gives you:
- `docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md`, especially §2 (defaults), §3 (arithmetic), §4 (storage and transaction contract), §5 (UI), §7 (acceptance criteria) and §8 (production constraints, which this prompt extends)
- the round-5 evidence pack `docs/evidence/m2-split-lineage-scope-round5-2026-10-08/`: the candidate DDL, the `lineageContract.mjs` model, `proof.test.mjs` and the mutation driver
- the acceptance and approval documents
- `CLAUDE.md`, the top of `STATUS.md`, and `docs/PROJECT_HANDOFF.md`

## 2. Workspace

1. Check that no competing split-lineage implementation exists on any remote branch or worktree.
2. Create a clean, isolated worktree from current `origin/main` on branch `codex/m2-split-lineage-implementation`, and record its exact base SHA.
3. Do not edit:
   - the scope checkout `/Users/rickymac/code/Flight-training-split-lineage-scope`
   - the dirty primary checkout
   - any other clone
4. Never reset, stash or force-push.
5. You may borrow `node_modules` by symlink only if the lockfiles are byte-identical. Disclose the link and remove it before handoff.
6. Use the working Mac toolchain:
   - Node 22
   - rustup Rust
   - `SDKROOT=$(xcrun --sdk macosx --show-sdk-path)`

## 3. What to build

Follow the accepted model's behaviour exactly, as it is proven in `lineageContract.mjs` and `proof.test.mjs`. Port it, don't redesign it.

1. **Migration 0013.**
   - Add `src-tauri/migrations/0013_split_source_lineage.sql` from the round-5 candidate DDL: both tables, every CHECK, both delete policies, and the indexes.
   - Register it in `src/data/migrations.ts` and `src/data/migration-checksums.json` the way 0012 was.
   - Set `CURRENT_SCHEMA_VERSION = 13`.
   - Never edit 0001–0012.
   - Browser mode (sql.js) uses the same migration list.
2. **Native split issues the receipt** (`src-tauri/src/pdf.rs` and its command).
   - While splitting, compute SHA-256 of the exact bytes being split, off the UI thread.
   - Take the page total from the PDF engine.
   - For a nested source, snapshot the parent lineage (root identity, hash, total, A's root range, level, and A's own title and file name).
   - Build a deterministic plan, then persist the canonical receipt and its hash as `pending` with a plain `INSERT` and the existing-row policy.
   - The webview never mints receipts or supplies hashes, totals or levels.
3. **Atomic save** (`src-tauri/src/documents.rs` `save_split_materials_at`, and `src/data/materialTransaction.ts` for the browser path where applicable).
   - Accept only a receipt that matches a pending log row; tamper verification is unconditional.
   - Re-hash the source file outside the transaction.
   - Inside `BEGIN IMMEDIATE`, re-check that the source row and file path still exist and that the nested snapshot is unchanged.
   - Insert materials, tags and lineage, and mark the operation committed, all in one transaction.
   - Refuse output-identity collisions with a named error.
   - Run cleanup at most once, and only for this operation's staging files.
   - Replay of a committed receipt returns the persisted parts.
   - Implement `cancel` as `(operationId)` only.
   - Reconcile by operation ID.
4. **Read model:**
   - structural direct/nested tiers, with separate parent and root verdicts (`matching`, `changed`, `missing`, `deleted`, `unknown`)
   - hashing off the render path, with "unknown" when nothing has been hashed
   - siblings grouped only by known effective identity
   - legacy rows return `lineage: null`
5. **UI** (`MaterialDetail.tsx`, `SplitPdfDialog.tsx`, `ManualSplitDialog.tsx`), per scope §5:
   - the source title and range
   - parent and root links using the correct tier's coordinates
   - an edition-correct sibling selector
   - the verdict note
   - a copy-page fallback (`openPath` can't target a page)

   Text is written for her: warm, plain and honest about "unknown". Use the existing dialog and UI primitives. No embedded viewer (SL-D8).
6. **Types:** add `SplitLineage` and the receipt types to `src/domain/types.ts`, keeping native and TypeScript shapes identical. Add the receipt and lineage results to the Tauri adapter shape checks, as C2 did.

## 4. Tests

Tests must be meaningful, synthetic and disposable. Never use her real data or launch against it.

1. **Port the accepted proof's behaviours into permanent tests:**
   - Rust tests for the native receipt, save, re-checks, cancel and reconcile
   - Vitest tests for the repository, read model and UI

   Cover every acceptance criterion in scope §7 and every SL-R1–R13 behaviour, including:
   - A20–40 / R101–300 ⇒ R120–140
   - tamper, missing-file, replaced-file and snapshot-drift refusals
   - re-issue never resetting a committed or cancelled operation
   - parent-tier fields coming from A
   - cleanup exactly once
   - the delete policies
2. **Migration safety:**
   - upgrade from a populated schema-12 database, with practice and card histories intact
   - a fresh install at 13
   - restoring an older (schema-12) backup into the new app
   - an older binary cleanly refusing a schema-13 backup (the existing `backup.rs` guard)
   - checksum-registry tests updated by adding 0013 only
3. **Native/TypeScript parity** for the shared lineage arithmetic and read results, using a small shared fixture as C2 did.
4. **Show sensitivity:** revert a few essential guards (the receipt gate, the snapshot re-check, the structural tier, re-issue) one at a time in a scratch copy. Each must be caught by a named assertion. Don't run a large mutation campaign.

## 5. Gate and evidence

1. Run focused checks during development.
2. After the source settles, run **one** sequential gate:
   - `npm run typecheck`
   - `npm test` with zero unhandled errors
   - `npm run build`
   - `cargo test --locked`
   - Clippy with `-D warnings`
   - `cargo fmt --check`
   - `npm run test:cargo-lock`
   - whitespace and scope checks
   - migrations 0001–0012 byte-identical, and the registry changed only by adding 0013
3. Keep the raw output and captured exits.
4. Write `docs/evidence/m2-split-lineage-implementation-<date>/` containing:
   - the owner approval
   - a requirement-to-test map
   - the gate receipts
   - the sensitivity results
   - a changed-path explanation
   - limitations
   - `source-hashes.json` (a `files` object)
   - `SHA256SUMS`
5. Leave every earlier evidence pack byte-identical.
6. Update STATUS and the handoff from origin/main's text, keeping all prior entries (C2 accepted, the Mac-only release pathway, scope acceptance), to say: "M2 split lineage implemented, pending independent source review."

## 6. Scope and stop

Out of scope:
- installed-app testing, signing, packaging, a version bump or release
- provider calls, account tests or new dependencies
- an embedded PDF viewer, OCR or a search index
- any feature beyond the approved scope

Leave everything uncommitted and unpushed. Report:
- branch, base, HEAD and staging state
- every changed and untracked path
- test totals and exits
- sensitivity results
- limitations, including that the installed app was not run

Then stop for independent review.
