# Independent M3 scope/prototype review evidence

Decision: **CORRECTIONS REQUIRED**, M3-R1–R7; see the [review](../../M3_SKILLS_EVIDENCE_SCOPE_REVIEW_2026-10-10.md) and [assignment](../../M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_PROMPT_2026-10-10.md).

`submitted-hashes.json` freezes all 57 submitted paths from worktree `Flight-training-m3-skills-scope` at base `48fa47d9d035b2636b72fd6692930d85f4992bb9`. The submission's 51 evidence hashes and 30 production/base anchors independently match. Its original ROADMAP/STATUS/handoff bytes are preserved under `submitted-documents/`; the current integrated documents prepend this review. The other 54 submitted paths are published unchanged. Both original top-level scope/prompt documents also have frozen copies. All 57 original worktree paths still matched after review; no subject or primary preflight changes were made.

## Independent receipts

Exact commands, exits, cwd, setup explanation and result summaries: `receipts/checks.json`. Raw stdout/stderr retained separately. Empty typecheck output is expected with exit 0; the structured receipt records that exit.

- Submitted original Vitest: **102 passed / 2 opt-in skipped**, exit 0.
- Submitted strict typecheck: exit 0.
- Submitted native crate: **7 passed**, exit 0.
- Frozen TS/UI diagnostics: **17 failed / 4 passed**, exit 1.
- Frozen native diagnostics: **3 failed / 2 passed**, exit 101.
- Initial native PATH setup error: exit 127, retained separately; corrected before baseline proof.

Failures are expected on the frozen submission; these are behavior assertions for correction, not accepted product tests. Existing production guard/native ceiling/benchmark/sensitivity receipts remain the implementer's evidence, not duplicated independent runs. No full application matrix or physical installed gates were run.

## Reproduce in a disposable copy

Use Node 22 and dependencies matching the committed package-lock; native cargo/rustc 1.99.0 via the rustup PATH. Start from a disposable copy containing the submitted scope pack plus unchanged application source/migrations. Never overlay the diagnostic files onto an active implementer's worktree. From that copy's repository root:

```sh
REVIEW_PACK=docs/evidence/m3-skills-evidence-scope-review-2026-10-10
SCOPE_PACK=docs/evidence/m3-skills-evidence-scope-2026-10-10
cp "$REVIEW_PACK/diagnostics/review-diagnostics.test.ts" "$SCOPE_PACK/tests/"
cp "$REVIEW_PACK/diagnostics/review-ui-diagnostics.test.tsx" "$SCOPE_PACK/tests/"
cp "$REVIEW_PACK/diagnostics/review-validation-cases.json" "$SCOPE_PACK/fixtures/"
cp "$REVIEW_PACK/diagnostics/review_diagnostics.rs" "$SCOPE_PACK/native/tests/"
node node_modules/vitest/vitest.mjs run --config "$SCOPE_PACK/vitest.config.ts" "$SCOPE_PACK/tests/review-diagnostics.test.ts" "$SCOPE_PACK/tests/review-ui-diagnostics.test.tsx"
CARGO_TARGET_DIR=/tmp/hfd-m3-review-target cargo test --offline --locked --manifest-path "$SCOPE_PACK/native/Cargo.toml" --test review_diagnostics
```

Scope helpers and raw candidate imports resolve relative to those test directories; copy the files exactly. `review-validation-cases.json` uses the submitted valid populated shared baseline, mutates only the specified facts and includes valid-candidate/built-in-retirement controls. The same cases run on both TS engines and native.

For R4, the frozen test demonstrates the legacy unpaged history API defect. If correction deliberately introduces a paged result, retain the frozen file/receipt and promote a meaningful paged equivalent: traverse bounded pages to revision 1 with no gaps/duplicates. For R7, the diagnostic explicitly accepts a typed STALE_CURSOR refusal instead of stale append; permanent tests must additionally prove the coherent restart and opposite crossing direction.

No diagnostic file is installed in `src/` or registered as production. The distributed evidence does not authorize M3 implementation or owner defaults. G1–G3 remain deferred and unverified.

## Integrity

`SHA256SUMS` covers every review-pack file except itself. Verify from this directory with `shasum -a 256 -c SHA256SUMS`. Preserve frozen files and original failed receipts; new corrections need a distinct evidence directory and new manifests.
