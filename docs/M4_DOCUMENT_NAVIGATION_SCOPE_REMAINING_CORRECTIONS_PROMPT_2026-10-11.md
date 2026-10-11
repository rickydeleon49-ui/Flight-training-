# M4 preparation: remaining corrections R5–R8

ACTIVE, model-neutral. Complete all four groups in one bounded preparation assignment. This supersedes the earlier M4 correction prompt for the current submission. M3 production is already approved and running separately; M4 defaults remain proposed.

## Start and protect current work

Work only in `/Users/rickymac/code/Flight-training-m4-viewer-evaluation`, branch `codex/m4-navigation-viewer-evaluation`, HEAD `c28ab8482c8635b0b2bf74686b081e02bf448f65`. Fetch first. Read from origin/main if missing, without pulling/resetting/stashing/cleaning or applying tracked documents over the dirty worktree:

- `docs/M4_DOCUMENT_NAVIGATION_SCOPE_REREVIEW_2026-10-11.md`.
- This complete assignment and the previous review/correction prompt for retained requirements.
- `docs/evidence/m4-document-navigation-scope-rereview-2026-10-11/README.md`, `submitted-hashes.json`, `diagnostics.test.mjs`, `frozen-import-adapter.diff` and the receipts.
- Current local evaluation, conditional prompt and correction report.

Verify **25/25 current submitted hashes**, **21/21 submitted checksums** and **29/29 original review checksums** before edits. Report competing modifications; preserve and build on them when safe. Protect the primary clone, Claude's M3 worktrees, existing submitted snapshots and shared ROADMAP/STATUS/PROJECT_HANDOFF. Supply proposed tracking entries separately.

Reproduce the submitted 15 passing proof/database tests, 3 Python checks, earlier ten diagnostics passing against current source, and new 13 failing assertions / 2 passing controls in a disposable copy. Use Node22 or disclose a different runtime. Keep frozen tests unchanged; API renames may use a minimal disclosed adapter without changing behavioral expectations. Two new diagnostics deliberately specify missing bound-aware reconciliation/persistence interfaces. Equivalent well-defined interfaces are acceptable.

## R5: make destination resolution complete

In candidate/proof only, require `Number.isSafeInteger` consistently for counts, indices and all lineage ranges/results. Unknown counts remain unknown. Physical clamping must be explicit, bounded and visible; malformed/ambiguous input cannot be silently clamped.

Legacy numeric `sourcePage` has no proven physical provenance. Both numbers and strings without explicit trusted coordinate space or a verified, content-bound label map remain unresolved. Validate physical strings (including zero, huge digit strings), mapped values and map identity/bounds. Preserve printed labels independently; never invent physical page1.

Validate root and immediate-parent range types, ordering, lengths and destination counts; reject concatenation, overflow, inconsistent metadata and out-of-bounds translation. Use the correct immediate-parent coordinates for nested splits. Return destination material ID and coordinate space in every successful direction, including root-to-child. Deleted root/parent or unavailable content returns snapshot guidance, never a substitute ID with the wrong coordinates. Cover positive physical/map controls, unknown counts, invalid identity, deleted root/parent, nested translations and the seven frozen R5 cases.

## R6: prove actual persisted replacement/revalidation

Keep the originating-content hash columns and original bookmark/reading records. Add a reusable disposable persistence protocol operating on candidate DDL, not just SQL inside individual tests. Require canonical valid hashes, trusted positive safe page counts, coordinate provenance and bounds before verifying any active destination. Matching hashes alone cannot verify a page42 bookmark when current bounds are10. Unknown/inconsistent identity stays unresolved, and prior-content records remain visibly unverified rather than relinked.

Exercise genuine file-backed SQLite using shipped schema1–13 populated with materials/lineage and representative prior rows. Apply the candidate only there. Prove close/reopen, identical replacement, A/50→B/10, old/new mixed bookmark generations, unknown identity, deliberate safe revalidation, cascade, and rollback after identity plus bookmark/reading changes (not only one cache update). Compare all relevant pre-existing values and affected rows. Use disposable backup/restore with different or missing document bytes, preserve authoritative navigation rows, and prove restored state is revalidated. Cover the existing backup schema/older-binary refusal boundary through a disposable compatible probe; do not alter production backup code or waive its invariant. Reuse unchanged proofs.

Bounds may be enforced by an explicit protocol in addition to candidate SQL; explain the trust boundary. Candidate naming stays provisional/unregistered. Do not allocate a production migration while M3 is in flight.

## R7: complete intent ownership and durable-save lifecycle

Advance/scope intent generation before validating each new request. A newer missing-file or invalid-destination intent must supersede earlier pending opens; all failure paths clear stale notice. Scope requested position by material AND originating content, so failed B never displays A's page42.

Validate explicit physical destinations before opener invocation. Unknown printed references may offer native-open/snapshot guidance but must not advance a guessed physical position. Preserve useful same-material prior progress on failed opening. Add an injected persistence boundary and test it with held promises/failures. Confirm opening success only after the actual opener resolves; save failure must accurately report “opened but position not saved” with deliberate retry, not replay the opener or claim the position was saved. Never mark reading confirmed from opening.

Guard publication and ownership around both open and save awaits. Define persistence cancellation/commit semantics so stale operations cannot overwrite newer durable progress. Test missing-path supersession, cross-material state, NaN/zero/unsafe destinations, route A→B→A, same-render competing intents, abort/unmount, delayed rejection, save failure, and late open/save callbacks. Keep recovery usable as a separate enabled action when navigation is unavailable. Preserve the working explicit-abort control.

## R8: finish truthful research, evidence and conditional handoff

Do not develop a new PDF parser. Treat the regex scanner as a limited fixture scanner or remove it from claimed parser proof. Its page-tree corruption diagnostic establishes why it cannot validate viewer behavior; that case may be retired with an explicit superseding real-parser proof, not a weakened assertion against the scanner.

Run one bounded real parser/viewer-candidate load, page enumeration, malformed-input and cleanup demonstration in scratch dependencies only. Existing shipped lopdf or a pinned evaluated engine is acceptable if the report precisely names the parser/runtime and does not claim embedded-viewer rendering was tested when it was not. Check expected fixture page counts, real parsing failures/recovery and resource lifecycle; report memory/bundle performance as unmeasured unless actually measured. Node success cannot prove old WKWebView.

Inspect exact selected package tarballs' LICENSE/NOTICE files, bundled PDFium/WASM/font/worker assets and relevant transitive licenses. Save immutable package versions, integrity/commit identities, artifact listings and primary-source links. Preserve known exact MIT registry metadata; distinguish SDK, engine and third-party notices. Use WebKit's Safari16.4 release note (Monterey/BigSur plus SIMD) to correct the OS13-only premise; remove guessed engine versions and verify any retained Safari/OS ceiling using primary sources. Keep unavailable physical compatibility explicitly unverified.

Synchronize evaluation, defaults, acceptance criteria and conditional implementation prompt with the final interfaces and proven invariants. Include provenance/map trust, complete destination identity/ranges, atomic drift/revalidation, backup/restore/older-version restrictions, opener/save failure recovery and late callback rules. A confirmed page is not whole-document completion. Prefer “Last requested page”; provide a distinct reachable recovery button. Production remains conditional on independent scope acceptance and OD-1–OD-10 approval; no approval is granted by this assignment.

Restore or explicitly archive original receipts02–04 and original SHA256SUMS byte-for-byte from the previously published submitted snapshot. Preserve today's 25-path submission and its receipts too. Create a **distinct** correction evidence directory with source hashes, command/runtime/exits/counts, final checksums and issue-to-test map. Add targeted sensitivity proofs by reversing decisive page/provenance, drift and intent guards in disposable copies; no changes to the primary proof files during mutants. Correct the premature all-resolved statement. Make the runner validate expected counts/exits and fail on unexpected/missing diagnostics instead of silently skipping them.

## Final gate and stop

Run focused corrected proof, current-source frozen diagnostics/equivalents and candidate persistence checks. Keep all old behavioral guards; justify API-only adapters and explicitly record replacement of the scanner demonstration. Verify manifests and production/shared-tracking invariants after final edits. No whole-app build/test matrix, physical login, real library access, provider call, installer/signing/release, shipped migration registration or production dependency/source edit is needed. G1–G3 remain deferred/unexecuted/unverified.

Deliver one correction report, complete new evidence, final source/checksum manifests, revised conditional prompt and proposed tracking entries. Leave changes uncommitted/unpushed for independent senior review, then stop.
