# Independent re-review: M3 scope/prototype corrections

**CORRECTIONS REQUIRED, M3-R8–R10.** [Report](../../M3_SKILLS_EVIDENCE_SCOPE_REREVIEW_2026-10-11.md), [assignment](../../M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md).

`submitted-hashes.json` freezes 127 correction-submission paths. The integrated tracking documents prepend this re-review; their submitted bytes are under `submitted-documents/`, and the other 124 paths are preserved directly. All hashes still matched in the unmodified subject after review. The corrections pack's 64 hashes, current scope pack's 56, six document hashes and 30 production anchors independently verified. Candidate 0014 is unchanged. Original submission receipts/manifests remain historical; the corrections pack's scope-pack-SHA256SUMS covers the current corrected prototype.

`receipts/checks.json` records each command, working directory, exit and counts. All test writes were disposable. Node 22 and unchanged primary dependencies were used, with the rustup toolchain scoped as recorded. Results:

- Corrected baseline: 162 passed / 2 skipped; strict typecheck clean; native 7 passed.
- Earlier frozen diagnostics: TS/UI 18 passed / 3 failed (two superseded R4 API calls, one invalid R2a setup); native 5 passed.
- Valid-erase R2a equivalent: fails on original frozen source, passes on corrected source. The executable difference is only expectedRevision → confirm, plus an explanatory comment. This independently confirms the implementer's correction to the original reviewer diagnostic.
- New diagnostics: TS/UI 6 failed / 1 positive control passed; native 1 failed / 1 valid-populated control passed. These expected failures on the submission expose the remaining defects.

## Reproduce new diagnostics

Use a disposable repository copy containing the submitted corrected scope pack and unchanged application source/dependencies. From that copy's repository root:

```sh
REVIEW_PACK=docs/evidence/m3-skills-evidence-scope-rereview-2026-10-11
SCOPE_PACK=docs/evidence/m3-skills-evidence-scope-2026-10-10
cp "$REVIEW_PACK/diagnostics/rereview-diagnostics.test.ts" "$SCOPE_PACK/tests/"
cp "$REVIEW_PACK/diagnostics/rereview-ui-diagnostics.test.tsx" "$SCOPE_PACK/tests/"
cp "$REVIEW_PACK/diagnostics/rereview_diagnostics.rs" "$SCOPE_PACK/native/tests/"
node node_modules/vitest/vitest.mjs run --config "$SCOPE_PACK/vitest.config.ts" "$SCOPE_PACK/tests/rereview-diagnostics.test.ts" "$SCOPE_PACK/tests/rereview-ui-diagnostics.test.tsx"
CARGO_TARGET_DIR=/tmp/hfd-m3-rereview-native-target cargo test --offline --locked --manifest-path "$SCOPE_PACK/native/Cargo.toml" --test rereview_diagnostics
```

These tests resolve imports from the scope tests folder. Do not overlay them onto an active implementer's checkout. For native, use a PATH containing the recorded rustup cargo. The existing corrected validation fixture baseline is the native setup and valid control; no new fixture is needed for these diagnostics.

The R8 cases separately change date, attribution and instructor name during a held save. R9 creates/validates a real written observation before removing its receipt; native likewise validates the populated fixture before removal. R10 obtains ERASED from the real reader after actual synthetic erasure, then asserts cached text/cursor and visible entry are gone. Its positive control preserves loaded history under a temporary read failure.

Preserve frozen files and failed receipts. New fixes must promote the same behaviors as permanent regressions, with meaningful controls, and supply new manifests. SHA256SUMS covers every file here except itself; verify from this directory. Installed testing remains deferred/unverified, production migration unregistered, defaults proposed.
