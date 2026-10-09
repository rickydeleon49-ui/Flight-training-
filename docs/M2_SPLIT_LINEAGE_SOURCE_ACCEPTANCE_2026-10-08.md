# M2 split-source lineage — production source acceptance (8 October 2026)

**Decision: the split-lineage production implementation is ACCEPTED for integration.**
It implements the accepted round-5 contract and owner-approved SL-D1–SL-D8 faithfully;
all delivery integrity checks verify, both full matrices reproduce, the 15-case shared
validator contract agrees across all three engines, and every sensitivity guard is caught
by its named test. No correctness defect was found in the feature code. See
`M2_SPLIT_LINEAGE_SOURCE_REVIEW_2026-10-08.md` and
`docs/evidence/m2-split-lineage-source-review-2026-10-08/`.

## What was accepted (independent numbers)

- Integrity: 35/35 source hashes, 32/32 pack checksums, manifest == git changed set,
  0001–0012 byte-identical, only 0013 added (checksum `4118a789…b106`), schema 13,
  `0013` byte-identical to the round-5 candidate, nothing staged.
- Reproduced: 110 focused Vitest; 41 focused native (single-threaded); typecheck; the 15-case
  contract on node:sqlite + sql.js + native; S1–S5 all caught & restored; full `npm test`
  2,862 passed / 5 skipped; full `cargo test --all-targets` 444 passed / 6 ignored.

## Recorded acceptance of the two disclosed decisions

- **Browser/test drivers read but do not write lineage (SL / decision 1):** accepted. The native
  splitter is the sole lineage writer because splitting needs file I/O and `lopdf`, which browser
  mode cannot perform; `executeMaterialsBatch`/`save_split_materials` stay generic so `createMany`
  is not regressed. Browser/test drivers are covered for reading, refusal
  (`SplitNeedsDesktopError`) and schema-13 restore validation across three engines. Scope §7's
  "native and browser drivers" is met for every operation browser mode can actually do.
- **Refused saves stay `pending` until the interface cancels (decision 2):** accepted, with the
  reconcile-before-cancel read-back keeping cleanup at-most-once and never deleting a landed split.

## One non-blocking finding to carry (F-1)

`documents.rs::split_test_root()` (a test helper unchanged from `origin/main`) names temp dirs
by `{pid}-{nanos}` and intermittently collides under default parallelism, redding the native gate.
It is not part of this feature and does not affect shipping behaviour. Apply the bounded fix
(unique per-test temp name, or run `cargo test --all-targets` with `--test-threads=1`) so release
CI is deterministic. The reviewer proved it fails on this source and passes once corrected.

## What must be published together (one PR)

None of the following is on `main` yet; publish them as a single, coherent change:

1. **This implementation** — branch `codex/m2-split-lineage-implementation`
   (`codex/m2-split-lineage-implementation` worktree at `2a6a415`): all 20 modified + 15 new
   paths and the evidence pack `docs/evidence/m2-split-lineage-implementation-2026-10-08/`.
2. **The accepted scope** — `docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md`
   (SHA-256 `6352f009…acd9b`) and the round-5 evidence pack.
3. **The scope review + acceptance** — `docs/M2_SPLIT_LINEAGE_SCOPE_REVIEW_2026-10-08.md`,
   `docs/M2_SPLIT_LINEAGE_SCOPE_REREVIEW_2026-10-08.md`,
   `docs/M2_SPLIT_LINEAGE_SCOPE_ACCEPTANCE_2026-10-08.md`, and the round-2/3/4/5 scope packs.
4. **The owner approval** — `OWNER_APPROVAL.md` (SL-D1–SL-D8) and `OWNER_DECISIONS.md`.
5. **This source review + acceptance** — `docs/M2_SPLIT_LINEAGE_SOURCE_REVIEW_2026-10-08.md`,
   `docs/M2_SPLIT_LINEAGE_SOURCE_ACCEPTANCE_2026-10-08.md`, and
   `docs/evidence/m2-split-lineage-source-review-2026-10-08/`.
6. **STATUS.md and docs/PROJECT_HANDOFF.md** updated from the latest `origin/main` text with every
   prior entry kept (C2 accepted, the Mac-only release pathway, the scope review/acceptance, the
   implementation-pending line, and this source-review acceptance line).

Publishing the scope, its review chain, the approval, the implementation, and this review in one PR
keeps the accepted contract, its authority trail and the shipped code in the same commit; schema 13
must not land without the scope + approval documents it references.

## Remaining Mac release gates (this review does not cover these)

This was a **source review**, run on disposable databases and synthetic files. Before a Mac release
that ships split lineage, the following remain and are **not** yet done:

- **Installed Apple Silicon smoke test.** Run the packaged app on a real M-series Mac end to end:
  split a PDF from the desktop, save, reopen the part page, copy-page, cancel. The IPC path was
  never exercised in a launched app.
- **Upgrade over populated data.** Install schema 13 over a real, populated schema-12 library and
  confirm the practice and card histories and existing materials are intact in place.
- **Restore of an older backup.** Restore a pre-13 (schema-12) backup into the new app, and confirm
  an older binary cleanly refuses a schema-13 backup.
- Signing, notarization, packaging and any version bump (owner's separate release decision; whether
  lineage ships in the first Mac release or a following one remains open — a release kept on
  schema 12 is possible because lineage is additive).

The reviewer edited no production code and left every reviewed file untouched.
