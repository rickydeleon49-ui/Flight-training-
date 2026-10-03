# Independent A3 source acceptance — 2 October 2026

**Decision: accept the corrected A3 source and regressions.** A3-R1–R4 are resolved. Required GitHub checks on the final publication head remain the merge gate. Installed macOS compatibility and release approval remain open.

Claude implemented the correction in the Mac clone on `codex/mac-webkit-compatibility-a3`, from main `8b61d8766a4aaf6a12443b9c48445ffe8cc43db7`. Codex reviewed the final files and committed that source as `66e81785a1ea851a7bc687f43672c959173be0c7`. The publication also includes the historical review documents from draft PR #47, so other agents can inspect the findings, diagnostics, corrections and final decision together.

## Review outcome

| Finding | Accepted correction |
| --- | --- |
| A3-R1: lower dialog exposed after a third opens | Exclusion is recomputed from the current top dialog, preserving original attributes for restoration. |
| A3-R2: layer reuse after a lower dialog closes | Each new dialog is placed above every live layer, with its backdrop immediately below it. |
| A3-R3: focus restored into a closed dialog | Restore targets inherit the closing lower dialog's target and are validated before focus moves; only the top dialog restores focus. |
| A3-R4: closing a parent hides its still-open child | Fallback Dialog and QuickFind presentations use React portals into `document.body`. Child visibility and viewport backdrop are independent of closed or transformed dialog ancestors. React ownership/context and controlled dismissal remain intact. Server rendering stays inline. |

The R4 regression opens the outer dialog, opens its child, then closes the outer while the child remains open. The child and backdrop are body-level elements; no closed dialog ancestor hides them. Maintained cases cover refusal to dismiss, top-owner Escape/backdrop requests, final focus return, reopening, unmount cleanup and StrictMode. Adapted background tests check exclusion through ancestors rather than requiring it on `main` itself; the original attribute-restoration guard remains.

Earlier toolkit ownership and secure UUID fallbacks remain accepted. The native modal path remains in use where both native methods exist. No dependency, lockfile, migration, Rust, bundle-identifier or minimum-OS change is included.

## Evidence and limits

- **Independent final run:** all five A3 suites pass, **53 tests**, exit 0, duration 753 ms. [Sanitized receipt](evidence/mac-a3-compat-2026-10-02/codex-final-focused-r4.txt). All **15 source/test hashes** match the final [implementation report](MAC_A3_COMPATIBILITY_IMPLEMENTATION_2026-10-02.md); committing and combining the documentation history did not alter those files.
- **Claude's completed matrix, inspected locally:** **655 frontend passed / 4 skipped**, build passed, **246 Rust passed / 6 ignored**, formatting, strict Clippy, lock synchronization and diff checks passed. [Final gate receipt](evidence/mac-a3-compat-2026-10-02/local-gate-summary-r4.txt). Codex inspected the original logs and did not rerun the unchanged full matrix.
- **Claude's R4 controls:** five of eight new cases fail on the earlier reviewed source; three pass as retained guards. Claude's verbatim Codex diagnostic and gated server-render benchmark pass. [Receipt](evidence/mac-a3-compat-2026-10-02/nested-lifetime-r4.txt). These controls were inspected, not independently rerun in this final review.

Node/jsdom capability removal does not establish real early macOS 12 WebKit layout, installed WKWebView, VoiceOver or installed Windows behavior. MAC-03 remains **UNVERIFIED**. No installed app or DMG was launched; account/signing prerequisites remain unmet. A2 remains with its Windows owner, A4/A6 remain separate corrections, and the frozen candidate and release holds remain unchanged.

After the publication merges and the Mac clone is synchronized, [Claude's next assignment is A4 saved study content offline](CLAUDE_MAC_A4_OFFLINE_STUDY_PROMPT_2026-10-02.md). Open-source adoption remains conditional on the existing measured need, contract, license and platform gates.
