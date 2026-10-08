# M2 card review C2 — production source acceptance (8 October 2026)

**Accepted for source integration. C2SRC-R1/R2 are closed.** C2-D1–D9 owner approval was recorded before implementation and remains effective. The containing source PR supplies exact-head CI and merge; this is not installed-app or release acceptance.

Reviewed implementation: `/Users/rickymac/code/Flight-training-c2-implementation`, branch `codex/m2-card-review-c2-implementation`, HEAD/base `cc84964737067cfa5fa5ed20ddf125a74b10b003`. All 32 final submitted hashes verify before and after independent execution. Seven of the original 30 paths changed this round; 23 remained identical; AppDataContext and its new revision test added two paths. The implementation checkout and both older dirty clones were preserved. Integration uses an isolated checkout based on current `origin/main` (`c7bf53f`).

## Findings closed

**R1 — authoritative publication invalidates all C2 views.** AppData publishes data and a monotonically increasing revision in one state update. Only the latest refresh may publish; startup cannot overwrite an already published refresh. Due, history and binder stream keys use that revision and retain the existing generation/operation-token ownership safeguards. Same-count/timestamp replacement, state-only ratings, refresh with preserved metadata and a held obsolete read are covered. No payload serialization/hashing was added to render.

Every successful publication can cause the mounted C2 stream to reread its first bounded page, including unrelated saves. Only the active tab's stream is mounted. This disclosed correctness tradeoff is accepted; the implementation's earlier ~40 ms due-reader measurement is in-process synthetic evidence, not installed UI latency. No new performance measurement is claimed.

**R2 — the viewer follows its selected event by ID.** A completed enrichment changes displayed provenance while historical front/back stay attached to the event. A missing selected row dismisses the viewer and clears the selection, preventing a later page or obsolete check from reopening it. Provenance now uses the same badge as the list.

**Correction to the first review's R2 evidence:** the original frozen diagnostic's baseline failed at line 186, a text-match precondition, before its reconciliation assertion. The first review overstated what that baseline alone proved. The implementer correctly disclosed this. Independent execution with the new badge retained but old copied-row state restored fails at line 191, the actual stale-provenance assertion (1 failed / 2 skipped, exit 1). Source was then restored byte-for-byte. Together with the passing final diagnostic and permanent tests, the defect and its fix are now independently established. The original diagnostic and receipts remain immutable.

## Verification

| Evidence | Result |
| --- | --- |
| Final submitted source | 32/32 hashes match before/after review |
| Original implementation evidence | 57/57 checksum entries verify |
| Correction evidence | 30/30 checksum entries verify |
| Independent affected suites plus frozen diagnostic | 112 passed / 1 skipped in 10 files, exit 0; includes all three frozen cases and the nine new permanent cases |
| Independent typecheck | exit 0 (temporary diagnostic removed first) |
| Independent integration build | exit 0 |
| Independent R2 semantic revert | old copied-row state with corrected badge: fails at line 191, exit 1; production source restored exactly |
| Submitted final sequential gate | 2,808 frontend passed / 5 skipped / zero unhandled; 420 Rust passed / 6 ignored; focused native 31 passed; build/typecheck/Clippy/fmt/locks/hygiene/preservation all exit 0 |

The submitted full gate ran once after corrections settled. Native readers, budgets, parity fixture and locks did not change in this round; their previously reviewed native results and the final submitted gate are reused, not claimed as an independently repeated native/full matrix. Shipped migrations 0001–0012 and their registry, dependency manifests and lockfiles remain unchanged in the integrated source.

The review pack contains raw independent outputs/exits, the exact submitted 32-path manifest, submitted live-document snapshots, final integration hashes and checksums. The correction evidence is published verbatim. The initial 57-entry implementation evidence and previous reviewer/planning packs stay unchanged.

## Scope and continuation

Accepted source delivers offline read-only library-wide Review due, card History with genuine version provenance, material badges, and navigation into the existing C1 session. Existing practice-test history stays separate. The previously reviewed route, C1 counting, 2,500-card budget, UTF-16 order and legacy timestamp choices remain accepted.

C2 closes the library-wide view portion of M2-4. Split parent/source page-range lineage remains unimplemented; M2 as a whole is not complete. The next [model-neutral assignment](M2_SPLIT_LINEAGE_SCOPE_PROMPT_2026-10-08.md) prepares its bounded contract and disposable proof, with explicit owner decisions before migration or production changes. No dependency, FSRS change, embedded PDF reader or provider integration is activated.

No installed Mac/Windows, WebKit minimum-OS, VoiceOver, signing, private installer or public release verification is claimed. Owner deferral of account testing and existing release holds remain in effect. Older pending C2 entries are historical after this source PR merges.
