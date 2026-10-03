# Independent A5 evidence acceptance — 3 October 2026

**Decision: accept the A5 source-tooling evidence reconciliation. No blocking findings remain.** Installed-app checks remain open. Required GitHub checks on the final documentation publication govern merge.

Claude's report and receipts were prepared on `codex/mac-a5-evidence-reconciliation`, from main `b5bf8e01cfbdf3e02900579450e023c6cf14074a` (merged A6 PR #50). Codex confirms the application, tooling and tests match that base. All four source hashes and all five receipt/script hashes match the reported values. The Swift reader is an evidence artifact, outside the application build.

Codex's final focused run after the tracker clarifications records **51 release-safety tests passed / 1 deliberate skip**, exit 0 (1.97 seconds). It covers fixture specifications, archive inspection and the checklist. The skip represents the explicit no-bash seam; the actual shell routine passed under macOS bash. [Independent review receipt](evidence/mac-a5-reconciliation-2026-10-02/codex-review-2026-10-03.txt).

Codex inspected Claude's raw logs and sanitized receipts for native PDF tests (**20 passed / 5 ignored**), the opt-in byte-heavy split (**1 passed**), fixture metrics, nine synthetic archive cases, PDFKit reader results and negative controls. These measurements were not independently repeated in this review, and no complete unchanged matrix was rerun.

## Accepted evidence and limits

- Fixture hashes agree with current specifications. The 60 image streams have distinct hashes and resist deflate compression; visible page IDs support order checks.
- The 54,032,644-byte source splits into pages 1–58 and 59–60, with both outputs below 50 MiB. The source remains unchanged. Native page coverage and wrong/repeated/reordered-ID controls pass.
- PDFKit independently reads source and split PDFs, extracts the reported consecutive IDs, and produces non-white thumbnail pixel samples inside the image region. Swapped/dropped-page controls report non-consecutive IDs. This is a reader/rendering probe; full visual inspection and installed-app behavior remain open.
- The archive inspector reports distinct absent/found/error outcomes, with non-disclosing fixed messages. Claude's nine-case CLI matrix includes actual permission denial. Entry-name inspection does not prove arbitrary database content contains no secret.
- The measured **573,046,784-byte maximum RSS** belongs to one debug test process generating, splitting and extracting this fixture. It is neither an installed-app measurement nor a memory bound for other inputs.

Windows-recorded and Mac-produced split sizes differ. Two Mac runs agree, and page ranges/limits agree with the historical record; the cause remains **unestablished**. Codex clarified the tracker to label the historical Windows manual output and the Mac manual output separately, and to distinguish thumbnail rendering from pending full visual inspection. Those documentation corrections do not require a source change.

A1/A3/A4/A6 are merged. A2 remains Windows-local with its assigned owner; no open A2 publication was found during this review. The next Mac task is [A2 verification preparation](CLAUDE_MAC_A2_VERIFICATION_PREPARATION_PROMPT_2026-10-03.md), with an explicit source-availability gate. Current installed readiness still needs the dedicated test account and acceptable signing state. Release holds, the frozen candidate and open-source adoption gates remain in force.
