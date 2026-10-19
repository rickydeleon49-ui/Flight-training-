# Independently review the app polish audit

Review `codex/app-polish-audit`, based on accepted main `fdbf290`. Start with `docs/APP_POLISH_AUDIT_2026-10-19.md` and the evidence README. This is Codex-authored work; supplied tests and self-checks are not independent acceptance.

The owner requested audit and polish. Scope is four bounded presentation/accessibility corrections:
1. V057-UI-01: three-action confirmation footer wrapping, including Cancel.
2. POLISH-02: long progress/notice text remains inside its flex row; status icons remain visible.
3. POLISH-03: stage/request/cancellation remain live-announced; elapsed seconds remain visible as ordinary text outside the live region.
4. POLISH-04: Field descriptions reference only rendered hint/error elements.

Verify source against that map. No native code, provider requests, save/retry/cancel state machine, migration, dependency or release setting should change. PR #234 is separate; do not copy, merge or reimplement it as part of this review.

Check `SHA256SUMS`, `source-hashes.json` and archive member hashes. Preserve the failing regression/first-gate receipts. The three new regressions failed before correction. The updated existing MaterialDetailCancel assertion now requires elapsed text to stay visible outside the live status; it was not removed just to obtain a pass. Final full frontend gate: 3,778 passed / 6 skipped, zero unhandled errors; typecheck/build/hygiene exit 0.

Use Node22 via a scoped PATH. Focused command:

```sh
npm test -- src/components/ui/Form.test.ts src/pages/StudyLibrary/GeminiProgress.test.ts src/components/ui/Dialog.test.ts src/components/ui/Dialog.fallback.test.ts src/pages/StudyLibrary/MaterialDetailGemini.test.ts src/pages/StudyLibrary/MaterialDetailGeminiModel.test.ts src/pages/StudyLibrary/MaterialDetailSourceChoice.test.ts src/pages/StudyLibrary/MaterialDetailCancel.test.ts
```

Inspect browser evidence carefully: ten narrow routes were checked before the corrections; ten desktop routes after them. The stress fixture renders actual components with synthetic props, not an installed application. A single createRoot warning during fixture HMR is disclosed. Native/fallback enlarged-text cases and short-window keyboard scrolling are measured separately. Actual VoiceOver, installed Mac/WebKit and all release gates remain unverified.

If repeating the browser cases, extract the fixture HTML/TSX from the evidence archive to ignored `screenshots/polish-audit/` in a disposable checkout, use its module paths and the repository browser-run skill, and start Vite on an unused loopback port. Never use a real profile/key or launch the native app. The long progress field is deliberately unbroken synthetic stress text; no claim is made that a provider returned that exact value. Cancel must close the confirmation with zero fixture send-counter increments. Keyboard focus must bring the Send action into view on a short native and fallback dialog without activating it.

Return acceptance or one consolidated correction report with a concrete trigger, source reference, impact and bounded fix for each defect. Do not perform a scheduling migration, implement OFFLINE-03, change release enablement, clean active database sidecars or self-merge. After independent acceptance, normal green exact-head CI is required before any owner-authorized integration.
