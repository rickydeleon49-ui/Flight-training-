# A4 saved study content offline — implementation report, 2 October 2026

**Publication follow-up:** [Codex accepted the A4 source and regressions](MAC_A4_OFFLINE_STUDY_ACCEPTANCE_2026-10-02.md) and committed the reviewed implementation as `c77dab9`. The local/uncommitted labels below describe the implementer handoff before acceptance; required exact-head CI and merge govern publication.

Implements audit finding A4 ([audit](FULL_REPOSITORY_AUDIT_2026-09-29.md#a4--p2-saved-local-guides-and-tests-are-hidden-after-disconnecting-gemini)) from [Claude's A4 prompt](CLAUDE_MAC_A4_OFFLINE_STUDY_PROMPT_2026-10-02.md). This is a source-level correction with jsdom/real-SQLite regressions. It is the implementer's report and **not Codex acceptance**. Installed-app offline behavior (MAC-19) remains **UNVERIFIED**.

## Identity and ownership

- **Task / date / roles:** A4 offline saved study content, 2 October 2026. Implementer: Claude (Mac). Independent reviewer and Git coordinator: Codex.
- **Machine / toolchain:**
  - MacBook Air (Mac17,3), Apple M5, 32 GB, macOS 26.6.
  - Node 22.23.3 / npm 10.9.9 via scoped `PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH`; rustc 1.99.0.
  - `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`.
- **Prerequisite:** PR #48 (A3) was merged as `1ae698669bc17f446cbed5bad20ad56538b2ce6e`, and `docs/MAC_A3_COMPATIBILITY_ACCEPTANCE_2026-10-02.md` is present. The earlier A3 checkout was clean, and its final hook hash (`69062aeb…`) matched main.
- **Branch / base:** `codex/mac-offline-study-a4` (upstream unset), created from clean `main` fast-forwarded to `1ae698669bc17f446cbed5bad20ad56538b2ce6e`. No `*a4*`/`*offline*` branch existed locally or on GitHub.
- **Code availability:** LOCAL UNCOMMITTED. Nothing committed or pushed.
- **Other owners:** A2 (material saves, SQL driver, attachment ownership) remains with its Windows owner. None of those boundaries were touched. A6 is not started.

## Root cause

In `src/pages/StudyLibrary/MaterialDetail.tsx`, the guide card's body was an either/or chain:

```text
not allowed → not ready → not configured → generating → saved guide → intro
```

So a saved guide rendered only when Gemini was connected and the source was eligible. A status that was still loading or had failed (`gemini === null`) counted as "not configured".

The practice-test card rendered only when the material had a file, Gemini was configured, and the source was allowed and ready. Both cards also required `material.filePath`. During a regeneration, the "working" state replaced the saved guide and test.

## Issue-to-fix map

| Issue | Fix (`MaterialDetail.tsx`) | Maintained regressions (`src/pages/StudyLibrary/MaterialDetailOffline.test.ts`) |
| --- | --- | --- |
| Saved guide, cards and practice test hidden when Gemini is disconnected | Saved content is rendered whenever it exists, independent of Gemini status or source eligibility. The guide card shows when `material.filePath \|\| studySet`; the practice card when `practiceTest \|\| (filePath && canOfferGemini)`. | "keeps the saved guide, cards and practice test usable with Gemini disconnected" |
| Status still loading, or the status check failing, treated as not configured and hiding content | The status is now tracked as loading (`gemini === null`), failed (`geminiStatusFailed`) or known. Each gets its own explanation; none hides saved content. | "keeps saved content usable while the Gemini status is still loading" · "keeps saved content usable when the Gemini status check fails" |
| A source that can no longer be sent (missing, replaced unsupported or oversized, detached) hides content or gives no reason | One `generationNotice` explains why creating or regenerating is unavailable, in priority order:<br>1. not allowed (including "no file attached")<br>2. unsupported or oversized type (with the existing "Create study-size parts" split offer)<br>3. missing file ("…Restore or re-attach the file to regenerate or create study aids from it.")<br>4. status failed<br>5. status loading<br>6. not connected (with the Settings link)<br>It is shown above saved content and never replaces it. | "explains a missing PDF and keeps saved content, with regeneration disabled" · "explains a replaced unsupported source and keeps saved content" · "explains a replaced oversized source and keeps saved content" · "keeps saved content when the material no longer has a file attached" |
| Submission must stay gated and explicit | `canOfferGemini` (configured, allowed and file-ready) alone decides whether the Create/Regenerate button exists. A missing file still disables it, as before. The click still opens the existing "Send to Gemini" confirmation; the mutual-exclusion lock, stale-result ownership and preflight checks are unchanged. | "offers regeneration for both saved items only when connected and the file is eligible" (positive control) |
| Regeneration hid the old guide and test while working; old content must survive a failure | The working status is rendered *above* saved content instead of replacing it. Failure behavior is unchanged: the error shows and the stored record is not overwritten. | "keeps the old guide visible during and after a failed regeneration" · "keeps the old practice test usable during and after a failed regeneration" |
| Cross-material lock and late completion while viewing saved content | No change needed. Existing safeguards cover it; this test adds the saved-content view. | "keeps another material's saved content usable while a generation runs elsewhere, and a late result changes nothing" (B's saved content is usable and its buttons locked; A's late result is discarded, per the existing ownership rule; the lock is then released) |

**No submission or network while reading:** every case spies on `fetch`, `generateStudyAid` and `generatePracticeTest`. Reading the guide, revealing and paging cards, and answering and scoring the saved practice test make **no** calls. Attempts stay transient (`PracticeTestPanel` state only). No schema change; M2 attempt persistence remains gated.

**Existing coverage reused, unchanged and passing:** `MaterialDetailGemini.test.ts` (10 tests) covers:
- duplicate-call prevention for both kinds
- stale results after navigation or attachment replacement
- missing-file preflight without calling Gemini
- cross-material locks in both directions
- direct-handler guards
- mutual disabling during generation

## Negative controls

- **Before the fix:** the new file (10 tests then) against `1ae6986`'s `MaterialDetail.tsx`: **9 failed / 1 passed**. All 9 failures were the intended defect: the saved guide heading or saved practice question was not found, or the missing-file regeneration explanation was absent.
- **After the fix:** all 11 tests against the original `MaterialDetail.tsx` (swapped in, then restored and verified by SHA-256): **9 failed / 2 passed**. The two passes are the connected guards (eligible regeneration, and the cross-material view), where content was already visible.

[Sanitized receipt](evidence/mac-a4-offline-study-2026-10-02/regressions-and-negative-control.txt).

## Verification receipts

| Exact command | Tested source | Exit / counts | Shared summary |
| --- | --- | --- | --- |
| `npx --no-install vitest run src/pages/StudyLibrary/MaterialDetailOffline.test.ts` | Original `MaterialDetail.tsx` | **1**; 9 failed / 1 passed | [regressions-and-negative-control.txt](evidence/mac-a4-offline-study-2026-10-02/regressions-and-negative-control.txt) |
| `… MaterialDetailOffline.test.ts MaterialDetailGemini.test.ts` | Corrected | 0; 20 passed | same |
| `… MaterialDetailOffline.test.ts` with the cross-material test added | Corrected | **1**; 1 failed: the test expected the late result saved to its source, but the existing rule discards it. Test aligned; no source change | same |
| `npx --no-install vitest run src/pages/StudyLibrary/` | Corrected | 0; 41 passed / 1 skipped (gated bench) | same |
| Negative control, 11 tests | Original `MaterialDetail.tsx` | **1**; 9 failed / 2 passed | same |
| **Final gate:** `npm ci` | Corrected diff | 0; 165 packages, 0 vulnerabilities | [local-gate-summary.txt](evidence/mac-a4-offline-study-2026-10-02/local-gate-summary.txt) |
| `npm test` | same | 0; 66 files passed / 3 skipped; **666 passed** / 4 skipped (655 plus 11) | same |
| `npm run build` | same | 0; `MaterialDetail` chunk 31.45 kB (9.79 kB gzip), against 30.98 / 9.56 kB before | same |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | same (no Rust change) | 0 | same |
| `SDKROOT=…26.5.sdk cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | same | 0 | same |
| `SDKROOT=… cargo test --locked --manifest-path src-tauri/Cargo.toml` | same | 0; 246 passed, 6 ignored | same |
| `npm run test:cargo-lock` | same | 0 | same |
| `git diff --check` plus an untracked-file whitespace scan | same | 0; clean | same |

The gate ran once, sequentially, after the final source change. No benchmark or DMG was rerun. Raw logs are local under `.smoke/mac-a4-offline/gate/`.

## Changed files and hashes (SHA-256)

```text
5948083339432f0ea73707bbfeb2b76813ced386ed9d3a5f2ec29f3c9f477d22  src/pages/StudyLibrary/MaterialDetail.tsx          (base e1748d7d…)
aab67d4d3d6b9be32875d384cbc8410060e5e697acb78f0b0c443584eb42caea  src/pages/StudyLibrary/MaterialDetailOffline.test.ts (new)
b572c35cc6323be3ce9d6aa91f4f65a48d53f178a7b72208a05828fbf3b68d64  docs/evidence/mac-a4-offline-study-2026-10-02/local-gate-summary.txt
f7da029d52f25614d15735d3a3684968cd30ede6b283ab07a235445a09c20295  docs/evidence/mac-a4-offline-study-2026-10-02/regressions-and-negative-control.txt
```

Also updated: `STATUS.md`, `docs/PROJECT_HANDOFF.md`, `docs/MAC_PARITY_CHECKLIST.md`. No dependency, lockfile, migration, Rust, configuration or Gemini key-boundary change.

## Behavior notes and limits

- **Visible change:** with a saved guide or test, the cards now show both a short notice explaining why regeneration is unavailable and the saved content. A material whose file is gone but whose guide or test remains now shows them. A material with a file but no saved test still shows no practice card unless Gemini can be offered (unchanged).
- **Simulation, not installed evidence:** "Offline" is simulated by a rejecting `fetch` spy plus Gemini status stubs; the desktop app's Gemini calls go through Tauri, which is not running here. The status check itself uses Tauri `invoke`, not `fetch`. Installed offline use (MAC-19), VoiceOver reading of the notices, and Windows WebView2 remain **UNVERIFIED**.
- **Unchanged and still gated:** Practice attempts remain transient; attempt persistence and other M2 schema work remain gated. Open-source adoption remains conditional: no MiniSearch, virtualization, Zod/react-markdown or EmbedPDF.
- **Unchanged:** macOS 12 / Windows support, migrations, backup v3 and v1/v2 restore, release holds and the frozen v0.5.3 candidate. No installed launch, live Gemini request, DMG, signing or account change.

Leave uncommitted for Codex review. A6 (retry wording) follows as a separate assignment.
