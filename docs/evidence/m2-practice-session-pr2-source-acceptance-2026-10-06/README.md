# M2 PR2 independent source acceptance evidence — 6 October 2026

See [source acceptance](../../M2_PRACTICE_SESSION_PR2_SOURCE_ACCEPTANCE_2026-10-06.md) and [next model-neutral scope assignment](../../M2_CARD_REVIEW_SCOPE_PROMPT_2026-10-06.md).

- `focused.txt` / `focused-result.json`: unchanged frozen read-recovery and controller diagnostics plus permanent suites, 208 passed, zero unhandled errors.
- The two `codex-*.test.ts` files are frozen evidence only; temporary copies were removed from application source after execution.
- `import-result.json`: separate actual StudyLibrary import suite, 21 passed; explicitly records this as observed tool output, not a fabricated raw log.
- `gate/`: full sequential current-main integration logs and command/exit/timing summary; 2,568 frontend passed/four skipped and 391 Rust passed/six ignored.
- `run_gate.py`: exact executed integration runner; existing dependency/build caches reused. No installed/profile/provider/release work.
- `preserved-receipts.json`: 132 original implementation files copied byte-identically. Old failed/partial runs stay in their original directories.
- `source-hashes.json`: repository-relative reviewed application/test and new acceptance/assignment/status paths, distinct from `SHA256SUMS` rooted in this evidence directory.

The containing PR must pass exact-head CI before merge. Earlier review/evidence packs are preserved; their historical failures are not relabeled successful. Raw-log whitespace allowances remain receipt-scoped.
