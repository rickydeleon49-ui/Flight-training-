# App audit and polish — 19 October 2026

## Scope

The owner requested an app audit and polish. This is a bounded source/browser pass of accepted main `fdbf290`, isolated on `codex/app-polish-audit` in `/Users/rickymac/code/Flight-training-polish-audit`. The stale primary clone and its dirty `.claude/settings.json`, Claude’s proposal worktree and pending PR #234 were preserved. No unmerged code was copied from #234.

Ten main screens were inspected at 390×844 and 1280×900 using the browser-mode app on a dedicated origin, with starter records and one synthetic material created through the UI. The final font-verified pass repeats all twenty route checks in a fresh Chrome context with the bundled Inter/Fraunces faces loaded; the initial in-app preview used fallback fonts and is preserved as limited evidence. The checks measure viewport/control overflow; they do not assert that every dialog or business operation was exhaustively audited. Material creation, confirmation Cancel, short-window keyboard access and modal fallback were exercised.

## Findings and fixes

| ID | Reproduction / impact | Correction / evidence |
| --- | --- | --- |
| **V057-UI-01** | The real three-action ConfirmDialog with Cancel / Choose a chapter or pages first / Send to Gemini, in the initial fallback-font preview at 390px width, placed Cancel from **x −125.8 to −46.1**, outside the dialog and viewport. The chapter action was partly clipped too. | Shared dialog footer now wraps actions; each action’s label can wrap within its available width. Five native/fallback/enlarged-text cases keep every action horizontally inside the dialog. Cancel closes without increasing the fixture’s send counter. A 390×480, enlarged-text check also proves keyboard focus scrolls Send fully into view in native and fallback modes; Escape closes. Actual installed Mac/WebKit acceptance remains pending. |
| **POLISH-02** | A synthetic long unbroken progress identifier widened a 390px page to **1,300px**; the status dot shrank away. | Progress/notice text may shrink and wrap inside its flex row, with status icons kept intact. The same stress fixture now has page width **390px**, with Cancel accessible. |
| **POLISH-03** | Elapsed seconds lived inside the polite status region, so its announced text changed every second even while the generation stage did not change. This is a DOM/live-region defect, not a claimed VoiceOver observation. | Only actual stage/request/cancellation changes live in the status region. Elapsed time remains visible and available as ordinary text beside it. Fake-clock tests prove ticks leave the live status text unchanged while visible elapsed time advances. |
| **POLISH-04** | A Field with both hint and validation error hid the hint but kept its absent id in `aria-describedby`. | Field now references only displayed help/error text. A complete valid → error → valid regression proves every referenced description exists and error semantics clear after correction. |

All four production changes are presentation/accessibility fixes. Gemini requests, retry/cancel/save behavior, schemas, dependencies, release flags and workflows are unchanged.

## Verification

- Seven focused suites passed **60/60** after the initial source corrections. Existing modal-stack/fallback and Gemini source-selection tests were included.
- Three new regressions **all failed on the original source** before correction. The initial raw output is preserved.
- The first full gate caught (a) a TypeScript-only option mistakenly used in the new test, corrected without changing its behavior; and (b) an existing test deliberately expecting elapsed time inside the live status. That assertion was updated to require the elapsed text remain visible **outside** the live region, alongside the new clock regression. The old assertion was not simply deleted. Failed receipts remain preserved.
- **Final sequential gate: typecheck exit 0; 3,778 frontend tests passed / 6 skipped, zero unhandled errors, exit 0; frontend build exit 0; whitespace exit 0.** Raw outputs and explicit exits are preserved. Native code is unchanged; the Rust suite and native benchmarks were not repeated.
- **Final font-verified browser recheck:** twenty routes (ten each at narrow/desktop width), five dialog layouts, two short-window keyboard cases, progress wrapping and Field descriptions pass with zero page errors. Expected font faces are explicitly verified loaded; font HTTP responses are 200 or valid cached 304. The initial preview/font-assertion/cache-assertion failures are retained in the archive and described in `font-recheck-notes.json`. Current screenshots use the bundled fonts.
- Route geometry, before/after stress values, five dialog cases, two short-window keyboard cases and screenshot proof are in `docs/evidence/app-polish-audit-2026-10-19/`.
- One `createRoot` warning occurred during hot reload of the ignored component fixture, before the later route checks. The console event is retained and attributed to that fixture; it is not represented as a clean console across the entire session.

The browser stress harness renders the actual production components with synthetic props. It has no provider, native bridge, profile or key. Its exact source is included in the receipt archive for reproduction; it is not imported into the app or production bundle. The route checks use the actual browser-mode application. Screenshot fixtures are labelled as fixtures rather than being presented as installed-app evidence.

## Review and remaining work

This is Codex-authored work pending independent review and exact-head CI. Start review with the four-row map above, then inspect the actual shared CSS, Field and Gemini progress component, the three new regressions and the changed existing integration assertion. Check all source/evidence hashes; rerun the focused suites plus `MaterialDetailCancel.test.ts` and normal CI. Native Rust/source gates can be reused only while those paths remain unchanged.

**V057-UI-01:** source/browser correction supplied; installed verification remains open. **V057-DB-01** (WAL/SHM classification) and **REL-CI-01** (release job timeout) remain open and were not silently closed as polish. No active database sidecars were deleted. The separate PR #234 search-link correction/proposal is still pending review; OFFLINE-03a/03b implementation remains next under the recorded owner approvals, then homework → exports. Extraction/search release enablement, minimum-spec pressure testing and installed acceptance remain gated.

No desktop application was launched, no real profile/key accessed, no provider called, and no installer built, signed or released. No merge or release is part of this task. Do not treat this bounded audit as release certification.
