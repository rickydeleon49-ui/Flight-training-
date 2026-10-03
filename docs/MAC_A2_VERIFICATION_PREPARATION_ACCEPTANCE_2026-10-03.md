# Independent acceptance of Mac A2 verification preparation — 3 October 2026

**Decision: accept the corrected preparation package. PREP-R1–R3 are closed.** This accepts the matrix, diagnostic observations, task-local controls and handoff. It does not accept the absent A2 production implementation, execute its diagnostic suite, or establish installed readiness.

Reviewed local branch: `codex/mac-a2-verification-preparation`, HEAD `54b82b3b59667b2ff9847c14fd6e44bcb3399e02`. The branch predates PRs #52/#53; Codex reconciles their prompt/review documents before publication.

## Findings closed

- **PREP-R1:** `observeMaterial` uses one SQL statement. The coherent-read case and explicitly conditional ownership-held case are separate. FIFO/no-owner positive and negative controls exercise the statement barrier on real engines. Multi-read `fullState` is explicitly settled-only.
- **PREP-R2:** snapshots retain complete material/tag rows, raw link identities, the readable LEFT JOIN view, counts and dangling references. Unrelated-table absence is explicit; other errors propagate. Recovery assertions include tag state. Foreign-key checks distinguish actual enforcement from refused work.
- **PREP-R3:** successful updates check the requested title, links, conserved fields/other rows and unrelated data; rejected saves compare prior state. Ordinary ending calls and conditional ownership-held calls cover execute/select separately, with sql.js reopened comparisons.

Codex independently ran the shared-helper controls on real node:sqlite/sql.js with project migrations: **36 passed, 0 failed, 0 skipped**, exit 0, **399 ms**. These use a stand-in owner and call no A2 API. Codex also independently collected **181** diagnostics, **57** conditional, without running their bodies. The five original reviewer case bodies are byte-identical to the reviewed `1902070e…` snapshot.

Codex inspected Claude's mutation logs: four weakened variants are rejected (14/4/2/2 failures); one equivalent variant passes. Those mutation runs were not repeated. The earlier engine/main-baseline/APFS capability receipts were preserved and not rerun. No full unchanged application matrix or installer was run.

## Identity and remaining limits

Thirteen of fourteen supplied file hashes match the handoff. The report's supplied hash was `384c6440ab01aedabea36c48a73269372ee3dcead6e22a726affadd70cfa6467`; its actual, stable reviewed hash is `79743cec11062e729f7b7b98111fffb201660a81f94869ec319f2d0a136423d2`. Codex reviewed that current text. No executable-artifact hash differs. Publication annotations and tracker reconciliation have separately recorded final hashes.

Matching A2 source remains unavailable at this review's GitHub check: no open PR or atomic-save branch was found. The [Windows owner handoff](MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md#10-copy-ready-handoff-for-the-windows-a2-owner-not-sent) is now shared for the owner to use; no message was sent.

The 57 conditional cases still need their actual source seams. Early macOS 12, installed WKWebView/VoiceOver, installed persistence/file conservation and release readiness remain unverified. Dedicated-account/signing prerequisites, Windows ownership, release holds and open-source gates remain in force.

[Independent review receipt](evidence/mac-a2-preparation-2026-10-03/codex-rereview-2026-10-03.txt). Next: [Claude Mac installed-readiness preparation](CLAUDE_MAC_INSTALLED_READINESS_PREPARATION_PROMPT_2026-10-03.md). Required GitHub checks on the reviewed publication head govern merge.
