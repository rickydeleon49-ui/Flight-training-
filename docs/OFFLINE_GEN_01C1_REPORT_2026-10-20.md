# GEN-01c-1 implementation report — 20 October 2026

Uncommitted implementation on `codex/offline-gen`, base `b2c513c`; Claude reviews/tests/merges.
No UI, dependencies, real keys/profiles/PDFs, or provider calls were added. Existing `node_modules` is untouched.

- Draft: journal `kind=pdf-kit`, `version=1`, run/editor operation UUIDs, creation time, review state, identity digest, source identity and bounded `KitCandidates`/evidence. Existing 8-job / 2 MiB draft / 16 MiB journal limits apply; nothing is evicted.
- Identity: managed material/path, PDF SHA-256, ordered pages, extractor/algorithm versions and page count. Cache-only preparation; no extraction/OCR/network fallback. Local worker has cancellation probes and a cooperative 30-second work bound.
- Commands: registered `prepare_pdf_study_kit(materialId,pages?)`, `get_pdf_study_kit(jobId)`; existing journal Cancel/acknowledge apply. IPC get omits the managed path; malformed candidates refuse. Reopen retains review candidates and never saves or dispatches work.
- Missing cache: typed `CACHE_MISSING`. Changed bytes/path/pages: typed `SOURCE_CHANGED` at get/new save; no implicit rebuilding. Exact committed retries still resolve from receipts after draft acknowledgement.
- Binding: optional `pdfKitSources={runId,run,items}`; strict shapes, bounds, unique evidence keys and canonical content hashes. Hash projections omit editor identity/origin; evidence remains tied to original wording across human edits.
- Both engines validate hashes before writes; content, evidence and receipt share one transaction. Exact retry is `already_saved`; reused operation id with changed/dropped sources is `CONFLICT`. Source-free payloads and legacy write behavior stay unchanged.
- Practice uses its existing receipt. Study sets had no hashed receipt table: additive migration **0019** adds PDF-bound study receipts only, with native/browser/backup validation. Drafts need no migration; migrations 0001–0018 are unchanged.
- Readers: saved study summaries/sections/cards and current displayed practice questions carry PDF evidence and human edit origin. Missing/damaged evidence returns an explicit unavailable label; it does not claim human or AI authorship. Canonical authoring snapshots remain the existing save protocol.
- Shared practice scenario: sourced save, exact retry, changed-source conflict, mismatched content hash refusal, dropped-source conflict, edit retaining sources, source-free save. Source-row counts are asserted by both engines.
- Additional shared study fixture: those receipt cases, instructor edit and exact retry after later editing. Backup test saves through both engines, checks nonempty evidence/receipts, and compares restored rows exactly.
- Failing-first receipts cover both parity engines, draft/cache/restart/source checks, study binding and provenance readers. Rollback/hash/backup tests were added after their implementation and lack an initial failing assertion; this requested sequencing is incomplete.
- Initial broad frontend failures were upgrade-table expectations; fixed without changing protected migrations. Native compile omissions and a timestamp-only synthetic-directory collision were fixed; an incoherent changed-pages test was corrected to carry matching source pages.
- Vite temp writes are sandbox-blocked; permitted `--configLoader runner` used. Schema-14 helper: 25/26; `pgrep` sandbox diagnostics break its CLI-prefix assertion. Claude must rerun it outside the sandbox.

Final gates: native **973 passed / 11 ignored twice**; frontend **4216 passed / 6 skipped twice**. Typecheck/build/clippy/lock/fmt/whitespace EXIT 0; schema helper EXIT 1 (25/26, sandbox pgrep).
SHA-256 for changed implementation/tests/report: [SHA256SUMS](evidence/offline-gen-01c1-2026-10-20/SHA256SUMS). Evidence manifest excludes itself.

Receipt inventory (stem: EXIT, counts; no tests = formatting/build/compile/startup check).
- `build-1`: 1, no tests; `build-runner`: 0, no tests.
- `cargo-lock`: 0, no tests; `cargo-test-1`: 0, 971p/0f/11i.
- `cargo-test-2`: 101, no tests; `cargo-test-3`: 101, 972p/1f/11i.
- `cargo-test-4`: 0, 973p/0f/11i; `cargo-test-5`: 0, 973p/0f/11i.
- `clippy-final`: 0, no tests; `clippy`: 0, no tests.
- `diff-check`: 0, no tests; `draft-native-1`: 0, 3p/0f/0i.
- `draft-native-red-assertions`: 101, 0p/3f/0i; `draft-native-red`: 0, 0p/0f/0i.
- `fmt-apply-2`: 0, no tests; `fmt-apply-3`: 0, no tests.
- `fmt-apply`: 0, no tests; `fmt-check`: 1, no tests.
- `fmt-final-apply`: 0, no tests; `fmt-final-check-2`: 0, no tests.
- `fmt-final-check`: 0, no tests; `kit-native-2`: 101, no tests.
- `kit-native-3`: 0, 27p/0f/0i; `kit-native-coherent-pages`: 0, 7p/0f/0i.
- `kit-native-collision-fix`: 101, 6p/1f/0i; `kit-native-final`: 101, 27p/2f/0i.
- `npm-test-1`: 1, 2 failed | 4213 passed | 6 skipped (4221); `npm-test-2`: 0, 4216 passed | 6 skipped (4222).
- `npm-test-3`: 0, 4216 passed | 6 skipped (4222); `parity-native-1`: 0, 1p/0f/0i.
- `parity-native-red`: 101, 0p/1f/0i; `parity-ts-1`: 0, 18 passed (18).
- `parity-ts-red-runner`: 1, 1 failed | 17 passed (18); `parity-ts-red`: 1, no tests.
- `reader-edit-focused`: 0, 25 passed (25); `reader-final-focused`: 0, 63 passed (63).
- `schema14-1`: 1, 25p/1f; `sources-ts-1`: 0, 22 passed (22).
- `sources-ts-2`: 0, 61 passed (61); `sources-ts-red`: 1, 2 failed | 2 passed (4).
- `study-sources-native-red`: 101, 0p/1f/0i; `study-sources-ts-red`: 1, 1 failed | 4 passed (5).
- `typecheck-1`: 0, no tests; `typecheck-2`: 0, no tests.
- `typecheck-3`: 0, no tests; `typecheck-final`: 0, no tests.
- `upgrade-focused`: 0, 21 passed (21).

[Complete receipt hashes/counts](evidence/offline-gen-01c1-2026-10-20/receipt-summary.json); [raw receipts](evidence/offline-gen-01c1-2026-10-20/receipts.tar.gz). The zero-test setup receipt is not failing-first evidence.

## Correction r1
- Added `edited_item_with_foreign_source_hash_shows_no_pdf_label` for user and instructor edits through real saves; a valid foreign hash matching no saved version yields invalid provenance, no PDF label and the preserved edit origin.
- Native `pdf_kit_sources.rs` has decode/content validation/write helpers, but no saved-item provenance reader or equivalent label guard; no native test added.
- Scratch-only `void hashes;` mutation: both new cases fail (2 failed / 7 passed); restored reader matches the worktree byte-for-byte and passes 9/9. Worktree production code and migration 0019 are unchanged.
- [Correction receipts](evidence/offline-gen-01c1-2026-10-20/correction-r1/): focused 9/9, typecheck and diff check EXIT 0; permitted Vite runner fallback after sandbox EPERM. Schema helper 25/26, EXIT 1 solely from sandbox-blocked `pgrep`; reviewer must rerun outside sandbox.
- Added the owner's migration-0019 approval line; rebound current ROADMAP/helper-test hashes and schema-14 manifest checksum. Everything remains uncommitted for Claude.
