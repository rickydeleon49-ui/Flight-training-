# Structured study-import Slice A: Gemini completion review, 3 October 2026

**SA1 is independently closed. SA2 requires documentation correction before source acceptance.** This is a focused review of Gemini's completion of the interrupted Mac implementation. Source remains local/uncommitted on `codex/structured-study-import-slice-a`, HEAD/base `696b07021f74104b800bc4a37c9ccb4c437a1abb`. Documentation revision reviewed: `f1099d8f49e79b1a96fe7ba0e611ad42c4cb0c5b` (PR #60). This publication contains review/prompt/evidence only; it does not publish or accept the source implementation.

## Submission identity and verification

Actual inventory: **93 paths: five tracked modifications and 88 untracked files**, including the final-hashes file. All **92 hashes** in Gemini's self-excluding receipt match. Receipt SHA-256: `ebfc2c7343a43951b396daf0f65280891c7d4ca841a30ba578828829d4642a68`. [All-93 independent snapshot](evidence/structured-study-import-slice-a-review-2026-10-03/reviewed-all-93-hashes.txt) includes that receipt; snapshot SHA-256 `b573ae2f5e7d9320e1f1f54b05b7d379745e8e27e92b8e79176daf01ffcb431a`.

Against Claude's reviewed 81-file starting snapshot, 80 files remain identical. Only `src-tauri/src/study_packet.rs` changed, for formatting and the cancellation-test lint correction. TypeScript production modules, fixtures, wrappers, dependency manifests and notice remain unchanged from that snapshot.

Codex ran the repaired CLI with `--self-test` and an output path in owned temporary storage: unmodified control 231 tests/exit 0; all 22 outcomes as expected, 19 caught/three neutralized, zero infrastructure errors; overall exit 0. A separate owned copy of the runner changes only M10's expectation from neutralized to caught and executes the actual CLI over all 22 rows: 21 expected/one unexpected, zero infrastructure errors, overall **exit 1**. This independently proves CLI aggregate failure propagation; Gemini's earlier API-level “would exit” log did not itself measure that process exit.

The built/source notices match byte-for-byte, SHA-256 `c497d9ea8d0a8fe60845a208370f698c457b94a0996fe131554955849cd7ba34`. Tracked `git diff --check` passes. [Evidence and exact commands](evidence/structured-study-import-slice-a-review-2026-10-03/README.md) preserve independent and reported results separately.

The earlier interruption review independently passed 241 focused frontend tests, typecheck and 16 reader tests. Those checks and full unchanged matrices were not repeated in this completion review. Gemini reports the full 941-frontend/266-Rust local gate green; those results remain Gemini-reported. No app-profile, real database, installed application, picker UI, Windows, signing or live provider check occurred.

## SA1: mutation setup repaired (closed)

The runner now copies lockfile/public notice, requires an unmodified control, detects missing/load/report/process and notice failures, and classifies actual failed assertions. All required normal outcomes reproduce without the prior contamination. Single-layer privacy defects remain neutralized. The self-test detects an intentionally wrong expectation; the normal `--self-test` command correctly exits 0 when that check and the normal mutation run succeed. The actual mismatched CLI diagnostic exits 1, as recorded above. No further runner change is requested by this review.

## SA2 (P2): implementation report and receipt describe behavior that is absent

The reviewed [implementation report](evidence/structured-study-import-slice-a-review-2026-10-03/reviewed-gemini-implementation.md.txt) has material discrepancies with the submitted source and accepted contract. These are documentation defects; change the descriptions to match the implementation, rather than changing correct code to match the report.

| Report claim and location | Verified behavior / source anchor |
| --- | --- |
| §2.1 line 23: 2 MiB, 64 KiB strings, 10,000 total elements/properties; §3.1 line 55: native cap 2,097,152 | `limits.ts:15-20` and `study_packet.rs:19-20`: 4 MiB (4,194,304 bytes), depth 8, 32 keys/object, 64 code points/key, nine integer digits, 250,000 values. Normalized strings have field-specific code-point caps, not a generic 64 KiB cap. |
| §2.2 line 32: named legacy/directive fields `action`, `replaceExisting`, `targetDeck` | Strict unknown fields are rejected. Targeted directive and legacy-answer classifications use the exact fixed sets in `limits.ts`; these examples are not those sets. Name actual classifications or simply describe strict rejection. |
| §2.3 lines 34–35: lowercase-only ID regex and uniqueness across cards/questions | `limits.ts:48-49`: item IDs match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`, choice/answer IDs use `{0,31}`. `semantic.ts` checks uniqueness separately within cards and within questions; choice IDs separately within each question. Syntax is enforced by schema, not by a different semantic regex. |
| §2.3 line 38: JWT credential detection | Actual patterns cover Google API keys, sk-style provider secrets, GitHub/Slack tokens, PEM private-key headers and AWS access-key IDs. There is no generic JWT detector. |
| §2.5 line 47 and §3.2 line 64: alphabetically sorted keys and two-space canonical JSON | `payload.ts:111-136`: compact `JSON.stringify` of a fixed-order nested array. The pure helper returns canonical JSON; callers calculate its SHA-256. It does not compute/return a canonical digest itself. The R5 guard is in semantics, not in payload mapping. |
| §3.1 line 53: `rfd::AsyncFileDialog` | `study_packet.rs:91-109`: Tauri dialog extension's `blocking_pick_file`, inside `spawn_blocking`; read is also on the worker. |
| §3.3 lines 66–69: `isDesktop`, `cancelled: true`, automatic validation and preview/payload result | `studyPackets.ts:71-81`: `isTauri`, returns null on cancellation or raw picked metadata/text; it does not call the validator or return preview/payload. Reader and validator are deliberately separate. |
| Handoff R3 labelled byte-drift, R4 labelled bounds | Accepted finding identities are R3 provider/import DTO compatibility plus reader/hash boundaries; R4 conflicting adoption/merge/release gates. Restore the accepted map and describe fixture/bounds checks separately. |
| Receipt system macOS 26.5.0 | SDK 26.5 is a compiler selection. Host was measured as macOS 27.0.1 in the interruption review and again with `sw_vers` during this review. Verify and distinguish host evidence from SDK; do not silently infer a historical OS version. |
| Handoff inventory: 92 submitted / 87 untracked; elsewhere 13 paths / 88 files | Current submission is 93 files: five modified, 88 untracked. Receipt contains 92 entries because it excludes itself. Counts after correction must be recomputed, not assumed. |
| Self-test claims measured nonzero exit | Existing self-test identifies a mismatch; the normal `--self-test` run exits 0. The saved API log says “would exit.” Cite Codex's separate actual CLI exit-1 evidence or supply an equivalent actual process receipt. |

The handoff also names `cleanDiagnostics`, which is absent; the actual boundary helpers are `publicError`/`failure`. Report source anchors should name actual functions and avoid claims of real WKWebView/CSP, macOS12 or installed certification from Node simulation. Review the complete report for similar unsupported details rather than fixing only the numeric limits.

## Required correction and next review

[Gemini's focused correction prompt](GEMINI_STRUCTURED_STUDY_IMPORT_SLICE_A_REPORT_CORRECTIONS_PROMPT_2026-10-03.md) assigns SA2. Preserve the original receipt, report and failed/intermediate evidence as dated history; write a clear corrected report/receipt or retain verbatim snapshots before revising authored summaries. Reconcile STATUS/handoff, regenerate exact hashes and validate links/whitespace. Production code, runner, fixtures, locks and full passing matrices should stay unchanged unless a new confirmed defect justifies a separate change.

Once accurate documentation is handed back, Codex reviews the correction and reconciles the existing publication with the source branch before source PR/required exact-head CI. No source commit, push or merge is authorized by this report's acceptance of SA1 alone. A2/M2, Slice B/C and installed/platform/signing/release gates remain pending.
