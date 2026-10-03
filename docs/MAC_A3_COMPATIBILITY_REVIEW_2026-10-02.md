# Independent A3 compatibility review — 2 October 2026

**Decision: corrections required before source acceptance.** Claude's implementation remains uncommitted on `codex/mac-webkit-compatibility-a3`, base `8b61d8766a4aaf6a12443b9c48445ffe8cc43db7`. This documentation publication does not include or accept that implementation.

Codex reviewed the actual API fallbacks, toolkit/ID changes, tests and implementation receipts. All 15 source hashes match the handoff. The review is bounded to the assigned source compatibility task; no installed WebKit/VoiceOver claim is made.

## Confirmed defects

### A3-R1 — P2: the previous modal remains exposed when a third sibling opens

`src/components/ui/useModalDialog.ts:129–139` gives any outstanding exposure unconditional precedence over later hides. With three mounted sibling dialogs, open A, then B, then C. B retained `exposedBy` from opening above A, so C's exclusion does not hide it. Independent test confirms A has `aria-hidden="true"`, C has focus, but B's `aria-hidden` is null. The lower dialog remains exposed to assistive technology and may retain multiple modal semantics.

Required correction: reconcile exclusion with the current top modal, exposing only its necessary ancestor path. Preserve nested-modal accessibility and original attributes; lower sibling dialogs must be excluded even if they were previously top. Maintain a three-layer regression and reverse-order cleanup checks.

### A3-R2 — P2: stack-length layer allocation can place a later modal behind an existing one

`src/components/ui/useModalDialog.ts:218` allocates layers from the current stack length while existing dialogs retain their old layer. Open A then B, close A first, then open C. B and C both have z-index 1004. The independent test mounts C before B in DOM order, so the intended top C has no higher paint layer than B; its backdrop is also below B. DOM order can therefore defeat visual/pointer modal ownership even though keyboard focus belongs to C.

Required correction: assign a layer above every surviving open dialog/backdrop, or recompute all live layers on stack changes. Verify strict visual layer ordering after out-of-order closure, reopening and differing DOM orders. A further ordinary two-layer test alone does not cover this.

### A3-R3 — P2: out-of-order closure restores focus into a closed dialog

`src/components/ui/useModalDialog.ts:233` checks only that the previous element remains connected. Open A from a page button, focus a control in A, open B, close A beneath B, then close B. Its saved previous target is still connected but belongs to closed A. In the independent jsdom test, focus ends on `inside-A` instead of the surviving original opener. Actual old-WebKit focus behavior is not observed, but the selected target is invalid under the fallback's own closed-dialog CSS.

Required correction: track a valid restoration chain when lower layers close. Avoid targets in closed, hidden, inert or disconnected regions. Restore to an appropriate surviving modal while one remains, and to the original available page opener when the stack empties. Preserve the rule that closing a lower layer cannot steal focus from the top.

## Verification

- Codex: `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx --no-install vitest run src/lib/id.test.ts src/logic/toolkitDefaults.test.ts src/components/ui/Dialog.fallback.test.ts src/components/quickfind/QuickFind.test.ts src/state/legacyWebKitStartup.test.ts`: exit 0, **37 passed**, 747 ms.
- Independent stack diagnostics: same PATH, `npx --no-install vitest run src/components/ui/codexA3.diagnostic.test.ts`: exit 1, **3 failed**, 420 ms. [Exact diagnostic source and sanitized observations](MAC_A3_COMPATIBILITY_REVIEW_REGRESSIONS_2026-10-02.md).
- Claude's final receipt/logs report **639 frontend passed / 4 skipped**, build passed, **246 Rust passed / 6 ignored**, fmt/clippy/lock/diff checks passed. Earlier test-file type-check failure is retained. These are implementer-run results, not a repeated Codex matrix.
- Codex did not repeat the full gate, benchmark, DMG build, native suite, source-swap negative control or installed app. The temporary diagnostic was removed. Claude's original files and all reviewed hashes remain unchanged.

[Copy-ready Claude correction prompt](CLAUDE_MAC_A3_CORRECTION_PROMPT_2026-10-02.md) assigns these three fixes, maintained regressions and final verification to Claude. A3, installed-platform gates and release holds remain open. No A4/A6 or package adoption is assigned yet.

Receipt clarification for Claude: the report's per-file counts of 8 ID and 12 toolkit-default tests overstate them. The actual suites contain 7 and 11 respectively (18 together); the overall maintained total of 37 is correct. Fix that documentation alongside the stack corrections.

## Reviewed source identity

```text
0d94f3857d5ef2a204f95981dd4bf158d73ca85031943712d0673e0cdf4f2085  src/lib/id.ts
53d0a3ccb96b2c26ee3a634c5701729a543576279c2608595fa77b76c349a33c  src/logic/toolkit.ts
f2d13871ae89fa295cdd09e26b31e143f68672d1a0c30f6e8be5ff7de5944c24  src/data/repositories/toolkitRepository.ts
7088890a9ec3c9de5c0fbb511c33ce2888892d797b37468bfff4b971d7ac25b7  src/state/AppDataContext.tsx
f036718bd1af68dc25bab9b7d6f08ea37a026a19797f64ce65dbf919a5341b3f  src/components/ui/Dialog.tsx
4ff06f12d01101ff5fc3b21f9969423ab04f97852c10ceb778ffa534b3995af8  src/components/ui/useModalDialog.ts        (new)
b191a4c454a4bb16cd65db9982eb9b122a053e4d879f4ccaf5f325c08591de06  src/components/ui/ui.css
1e3d3b498143c75feaf67bb37d0d003e3aee3e40f84a05e0cfeb8d8e647ef63e  src/components/quickfind/QuickFind.tsx
73750df11058f6eb5460dae469a5cb7001e9aeffac9040a1600f7ed07dc13d09  src/components/quickfind/quickFind.css
7dead87ec20670b2bf18100ef9f2ca037a91e3165cca608a9d53663231aa79c4  src/testing/capabilities.ts                (new)
5c9bd554ac3ad75435e11ef232f59bdca619bf7db60272f63e18a2b00d78119b  src/lib/id.test.ts                         (new)
55a11a659cc06af753dcce70806fe7acac6f13fe7cc0342aace4cf9bcf9c1dc0  src/logic/toolkitDefaults.test.ts          (new)
6670ca5e5341c9803238bd4d61f6dfd9db85dc09359e7f85c4e31f8974a89175  src/components/ui/Dialog.fallback.test.ts  (new)
f7a697510970c195d5d3be7a6beaa1cd6da5e22a189cbaca8987b3b709a9c4df  src/components/quickfind/QuickFind.test.ts (new)
173c1f6374cd195cbcb3cf4012d09027b719f6f21fb329b91622ad8fd48e2c72  src/state/legacyWebKitStartup.test.ts      (new)
```
