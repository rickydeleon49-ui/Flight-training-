# Structured study-import Slice A: independent source acceptance, 3 October 2026

**Accepted for source integration under the recorded owner exception. SA1 and SA2 are closed.** Slice A introduces exactly `zod@4.6.5`, pure packet validation/preview and import DTOs, the read-only native picker and desktop wrapper, tests and the Zod notice. It creates no database save operation or import screen. This dated review precedes publication: integration requires the containing source PR's required check on its exact head and a current main branch. The merged PR is the integration receipt.

## Review identity and correction result

The Mac checkout is `/Users/rickymac/code/Flight-training-`, branch `codex/structured-study-import-slice-a`, implementation base `696b07021f74104b800bc4a37c9ccb4c437a1abb`. Documentation main was fetched and confirmed at `0e373cb9ef6865f9b793bb1e71b213a291c03ee1` before reconciliation.

Codex independently verified **95/95 submitted hashes**, covering **96 files including the self-excluding receipt**. Submitted receipt SHA-256: `5ee43fa13a9b8eccae63b909f00a7b1b1716934915f2b619fe6987757be5983e`. Against the prior 92-entry reviewed receipt, only STATUS, PROJECT_HANDOFF, the implementation report, evidence README and authored full-verification receipt changed. Production code, mutation runner, tests, fixtures, manifests, locks and the notice remained byte-identical. The three historical snapshots match the previously published originals exactly. [Independent validation and submission receipts](evidence/structured-study-import-slice-a-acceptance-2026-10-03/README.md) preserve this identity before publication edits.

The [corrected implementation report](STRUCTURED_STUDY_IMPORT_SLICE_A_IMPLEMENTATION_2026-10-03.md) now describes the actual 4 MiB limits, scanner/string bounds, ID syntax and uniqueness scopes, fixed field sets, six credential patterns, diagnostic helpers, canonical array JSON, semantic source-note guard, native dialog worker, raw desktop wrapper, host/SDK distinction, R1–R5 identities and measured process-exit evidence. These resolve **SA2** from the [prior review](STRUCTURED_STUDY_IMPORT_SLICE_A_REVIEW_2026-10-03.md). No further production defect was confirmed in this focused re-review.

Codex made two small publication corrections: references to a nonexistent `codex-cli-mismatch-exit-1.txt` now cite the existing [results, log and measured-exit receipt](evidence/structured-study-import-slice-a-review-2026-10-03/README.md); the relocated historical report uses `.md.txt` so its old relative links are inert, with every original byte preserved. Current status also labels the Function-constructor test as a Node simulation rather than installed CSP evidence. No source change or new full test matrix was needed.

## Evidence and practical limits

| Evidence | Attribution and result |
| --- | --- |
| Focused validator/wrapper tests, typecheck and native reader tests | Codex independently passed 241 frontend tests, typecheck and 16 native tests in the [interruption review](STRUCTURED_STUDY_IMPORT_SLICE_A_INTERRUPTION_REVIEW_2026-10-03.md). The later Rust change is formatting plus the cancellation-test lint correction; production reader behavior is unchanged. |
| Mutation sensitivity and real CLI failure | Codex independently reproduced clean control 231/exit 0 and all 22 expected outcomes: 19 caught, three neutralized, zero infrastructure errors. A separate CLI run changing only M10's expected classification produced 21 expected/one unexpected and actual exit 1. [SA1 evidence](evidence/structured-study-import-slice-a-review-2026-10-03/README.md). |
| Full sequential local matrix | Gemini-reported: 941 frontend tests passed, four skipped; build/typecheck passed; 266 Rust tests passed, six ignored; fmt, Clippy, lockfile and whitespace passed. [Corrected authored receipt](evidence/structured-study-import-slice-a-2026-10-03/full-verification-receipt.txt). Codex did not repeat the unchanged full matrix. |
| Notice inclusion | Previously independently compared public and built notices: identical SHA-256 `c497d9ea8d0a8fe60845a208370f698c457b94a0996fe131554955849cd7ba34`. Tauri embeds the frontend dist directory; no installer was produced in this task. |
| This re-review | Hash/inventory comparison, source-to-report comparison, verbatim snapshot checks, current links and whitespace. Final integrated publication hashes are in the [final receipt](evidence/structured-study-import-slice-a-2026-10-03/final-hashes.txt), distinct from preserved submission receipts. |
| Required source CI | Must pass `Tests, types, and the data-safety guards` on the exact containing PR head. This source PR uses the full Ubuntu path, not documentation-only verification. Check the PR for its measured result. |

No owner profile, real database, installed app, native picker UI, actual WKWebView/CSP, VoiceOver, early macOS 12, Windows behavior, signing or live provider was tested. Node capability simulations and reader tests establish their stated source boundaries only. Installed-Mac checklist states remain unchanged.

## Remaining work

The [owner exception](STRUCTURED_STUDY_IMPORT_SLICE_A_OWNER_EXCEPTION_2026-10-03.md) ends with Slice A. Slice B needs published/accepted A2, the M2 real-user check-in and scoped approval, and product decisions D1–D9 including D3. Slice C is optional and needs separate dependency/compatibility review. No migration, replacement operation, other dependency or release decision is authorized by this acceptance.

The [next Gemini preparation prompt](GEMINI_STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_PROMPT_2026-10-03.md) assigns a concrete decision/test plan using the newly accepted code. It does not authorize Slice B implementation. Installed testing still needs the dedicated standard account and signing decision. Existing Windows and frozen Mac release holds remain in effect.
