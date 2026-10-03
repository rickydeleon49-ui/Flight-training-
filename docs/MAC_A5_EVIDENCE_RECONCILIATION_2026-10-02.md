# A5 Mac fixture and verification-kit evidence reconciliation — 2 October 2026

**Publication follow-up (3 October):** [Codex accepts this A5 tooling/evidence reconciliation](MAC_A5_EVIDENCE_ACCEPTANCE_2026-10-03.md), with tracker clarifications for thumbnail rendering and Windows/Mac manual-output sizes. Local/uncommitted labels below describe the original handoff; required GitHub checks and merge govern publication.

Verifies the A5 tooling fixes already on `main` against current Mac evidence, from [Claude's A5 reconciliation prompt](CLAUDE_MAC_A5_EVIDENCE_RECONCILIATION_PROMPT_2026-10-02.md). **No tooling, test or production source was changed.** No tested A5 tooling requirement failed on this Mac. This is a documentation and evidence reconciliation, and it is the implementer's report, **not Codex acceptance**. Installed-app splitting, Finder, Gatekeeper and VoiceOver remain **UNVERIFIED**.

## Identity and ownership

- **Task / date / roles:** A5 evidence reconciliation, 2 October 2026. Implementer: Claude (Mac). Independent reviewer and Git coordinator: Codex.
- **Host:** MacBook Air (Mac17,3), Apple M5, 32 GB, **macOS 27.0.1 (26A434)** per `sw_vers`. Earlier reports' 26.6 is a historical entry; no upgrade date is inferred.
- **Toolchain:**
  - Node 22.23.3 and rustc 1.99.0 via scoped `PATH`; `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`.
  - Swift 6.3.3 (Command Line Tools), used only for the PDFKit reader script.
- **Prerequisite:**
  - PR #50 (A6) merged as `b5bf8e01cfbdf3e02900579450e023c6cf14074a`, with `docs/MAC_A6_RETRY_WORDING_ACCEPTANCE_2026-10-02.md` on main.
  - The previous attempt correctly stopped while PR #50 was still open.
- **Branch / base:** `codex/mac-a5-evidence-reconciliation` (upstream unset), from clean `main` fast-forwarded to `b5bf8e0`. The only remote name containing "a5" is the unrelated historical `claude/her-flight-deck-spec-sxa0a5`.
- **Code availability:** LOCAL UNCOMMITTED documentation and evidence only.
- **Other owners:** A2 remains with its Windows owner.

## Provenance

- **`81f98b2`** (2026-09-29, "test: harden Mac readiness kit and record release blockers") introduced the corrected kit:
  - `scripts/generate-pdf-fixtures.mjs`, `scripts/inspect-backup-credentials.mjs`
  - the fixture, PDF and coverage tests in `src-tauri/src/pdf.rs`
  - the archive, fixture and checklist tests in `src/logic/releaseSafety.test.ts`
  - the tracker metrics, including Windows-host split sizes
- **`61860b0`** (2026-10-01) only removed the generator's shebang line.
- **Since `81f98b2`:** no change to `src-tauri/src/pdf.rs`, `src-tauri/Cargo.toml` or `src-tauri/Cargo.lock`.

Source hashes at base, unchanged (SHA-256):

```text
a883c135597d1f1554bef7aadbdfa4a46285deb3727a5d3c4ff0563b8aea5823  scripts/generate-pdf-fixtures.mjs
3b918bd7ff23d8ead06001f77fd356824aa9d5c6ee8329abddcdf70a1e5ec815  scripts/inspect-backup-credentials.mjs
375e8fe3f6e51043368769710300b589f3c2054fe3eb885d136430c99bfa8a8b  src/logic/releaseSafety.test.ts
f69eeb6df82661da01daeb96cda05e3d43ba5ce740d1b1f3b30d2b218214fe14  src-tauri/src/pdf.rs
```

`src-tauri/src/pdf.rs` was temporarily extended for a diagnostic, then restored and verified against this hash after each run.

## A5 finding → current evidence

| Dated A5 finding | Current source | Verified on this Mac | Classification |
| --- | --- | --- | --- |
| Constant-value image bytes; Fixture C might not truly need byte-limited parts | Per-page LCG-filled raster, written immediately | 60 image streams, **60 distinct** SHA-256 values; deflate level 9 gives **1.0003** per image (900,281 / 900,000) and 0.9999 for the whole file. The constant-value control deflates to 895 bytes, matching the audit's 896. **Real byte-limited split:** 2 parts, part 1 at 52,229,815 bytes (49.81 MiB, under 52,428,800) | Corrected in source; **verified** |
| `imgBuf` reused and mutated, so all images identical | New `Buffer.alloc` per page, written at once | 60 distinct image hashes; PDFKit renders an image on all 60 illustrated pages | Corrected; **verified** |
| Identical text pages weaken order checks | Visible `Synthetic <label> - Page N of M (ID: P000N)` per page | IDs 1–60 strictly ordered in content; PDFKit extracts consecutive IDs from all 10 / 1,050 / 60 pages | Corrected; **verified** |
| Page coverage after splitting | `verify_exact_page_id_sequence` plus a negative test | Native tests: 1,050-page automatic and manual split and the negative validator pass. Opt-in 54 MB split: IDs 1–58 and 59–60, combined 1–60; manual 10–20 is exactly IDs 10–20 | Corrected; **verified** (source level) |
| Independent-reader validity | Tracker cites pdfjs-dist / pdf-lib on Windows | Neither package is installed here, and none was installed. **Apple PDFKit** (system framework, separate implementation) read all sources and split outputs with correct page counts and IDs and rendered images. Negative control: swapped and removed pages are both flagged (`consecutive=false`) | **Verified on this Mac** with an actual available independent reader |
| `unzip \| grep && … \|\| PASS` could report PASS on error and print names | Node ZIP parser, fail-closed, exit **0 absent / 1 found / 2 error**, fixed messages | Release-safety suite: 51 passed, 1 deliberate skip. CLI matrix over 9 synthetic cases: absent 0; top-level and nested secret 1; missing, **unreadable (real `chmod 000` denial)**, truncated, malformed, directory and no-argument 2. Secret value printed in **0 of 9** cases, and no entry names printed. The documented shell routine ran under macOS `/bin/bash` 3.2 | Corrected; **verified** |
| Bounded/stable memory claims too strong | Tracker says windowing does not guarantee source-independent RSS and asks for measured peak RSS | Empirical, narrowly scoped: the opt-in split **test process** (debug build, generates, writes, splits and extracts the 54 MB source) had a maximum resident set of **573,046,784 bytes** and a peak footprint of 563,381,280 bytes (`/usr/bin/time -l`). Not app, release-build or WKWebView memory; not a bound for other inputs | Wording already truthful; **measurement recorded with limits**; installed RSS (PERF-MAC-03) **UNVERIFIED** |

### Reconciliation findings (documentation only)

1. **Windows vs Mac split sizes.** The tracker's Fixture C part sizes were measured on a Windows host in `81f98b2`: 51,731,349 and 1,784,008 bytes. This Mac produces **52,229,815** and **1,801,351** bytes from the same source hash and the same `pdf.rs`/`Cargo.lock`. Two Mac runs were byte-identical (part SHA-256 `cb4f5f86…` and `e4259946…`). Page ranges and limit compliance agree. The cause is not established from this Mac (possibly platform or measurement path). The historical Windows values are kept, and the Mac measurement is added beside them, labelled.
2. **Independent-reader claim.** It is now labelled as the Windows host's, with the Mac PDFKit verification added.
3. **Test name.** "executes the documented shell routine in a Windows-hosted Git Bash environment…" falls back to `bash` on PATH, so on this Mac it exercised macOS bash. It passes, so this is a naming nuance and was left unchanged.

## Commands and results

| Command | Exit / result | Receipt |
| --- | --- | --- |
| `npx --no-install vitest run src/logic/releaseSafety.test.ts --reporter=verbose` (before doc edits) | 0; **51 passed, 1 skipped** (deliberate "no bash" seam) | [release-safety-and-archive-check.txt](evidence/mac-a5-reconciliation-2026-10-02/release-safety-and-archive-check.txt) |
| `node scripts/inspect-backup-credentials.mjs <synthetic archive>` × 9 | Exit codes as tabled above; 0 disclosures | same |
| `node scripts/generate-pdf-fixtures.mjs <temporary dir>` | 0; 3,360 / 330,934 / 54,032,644 bytes with the recorded SHA-256 values (no change) | [fixture-measurements.txt](evidence/mac-a5-reconciliation-2026-10-02/fixture-measurements.txt) |
| Node zlib content measurement of Fixture C | 60 distinct images; ratio 1.0003; IDs 1–60 ordered | same |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml pdf::tests` | 0; 20 passed, 5 ignored (opt-in / performance) | [native-split-evidence.txt](evidence/mac-a5-reconciliation-2026-10-02/native-split-evidence.txt) |
| `/usr/bin/time -l <test binary> --exact pdf::tests::opt_in_byte_heavy_charts_fixture_split --ignored --nocapture` | 0; 1 passed; 11.57 s; max RSS 573,046,784 bytes | same |
| Temporary keep-outputs diagnostic (same helpers; `pdf.rs` restored and SHA-256 verified), run twice | 0; parts 1–58 / 59–60; byte-identical runs | same |
| `swift pdfkit-reader.swift <PDFs>` (SDK 26.5) on sources, outputs and tampered copies | All correct; tampering detected | [independent-reader-pdfkit.txt](evidence/mac-a5-reconciliation-2026-10-02/independent-reader-pdfkit.txt), [script](evidence/mac-a5-reconciliation-2026-10-02/pdfkit-reader.swift) |
| `npx --no-install vitest run src/logic/releaseSafety.test.ts` (after the tracker edits; it reads the checklist) | 0; **51 passed, 1 skipped** | local log |
| `git diff --check` plus a relative-link check of the changed docs and an untracked-file whitespace scan | 0; all links resolve; clean | — |

No script, test or production file changed, so the full required matrix was **not** rerun, per the prompt. No benchmark or DMG was rebuilt. Large PDFs, archives and raw logs stay out of Git (local `.smoke/mac-a5-reconciliation/`).

## Remaining-foundation checkpoint

| Item | State |
| --- | --- |
| A1, A3, A4, A6 | Merged (PRs #42, #48, #49, #50) |
| A5 | Tooling fixes verified on this Mac at source level; documentation reconciled; installed-only parts open |
| A2 atomic material saves | **Open**, Windows-local with its owner |
| Installed readiness (MAC-03, -08 to -10, -19, PERF-MAC-01 to -06) | Blocked on a dedicated standard test account and an acceptable signing state |

**Recommended next bounded assignment (not started):** Get A2's reviewed source onto GitHub (its Windows owner and Codex), then a Mac verification of A2's save, replace, Cancel and tag-replacement conservation against real SQLite. In parallel, the owner provides the dedicated test account and a signing decision so the installed smoke matrix can run. A small optional follow-up is to establish the Windows/Mac split-size difference with a matched measurement on Windows; it doesn't block anything. Open-source adoption stays conditional (no MiniSearch, virtualization, Zod/react-markdown or EmbedPDF), and M2, import, the embedded reader and iOS remain gated.

Leave uncommitted for Codex review.
