# Slice A focused acceptance evidence

Supports the [independent acceptance](../../STRUCTURED_STUDY_IMPORT_SLICE_A_ACCEPTANCE_2026-10-03.md).

- [Submitted SA2 receipt](reviewed-sa2-final-hashes.txt): verbatim 95-entry self-excluding receipt, SHA-256 `5ee43fa13a9b8eccae63b909f00a7b1b1716934915f2b619fe6987757be5983e`.
- [Independent all-96 snapshot](reviewed-all-96-hashes.txt): hashes every submitted file, including that receipt, before Codex publication edits.
- [Validation result](review-validation.json): measured inventory/hash match, exact five documentation changes, unchanged-source proof and historical snapshot comparison. Methods: compare current SHA-256 bytes against the submitted and prior reviewed manifests; compare each historical snapshot to `git show origin/main:...` bytes; inspect current source/report, links and whitespace.

The archived report was subsequently renamed from `.md` to `.md.txt` without byte changes. Current authored documents cite the existing CLI result/log/README instead of the nonexistent exit-specific filename. STATUS/handoff/tracker and the implementation report point to acceptance; the final publication also includes its next-task prompt. These administrative changes intentionally differ from the submission snapshot.

The [final integrated receipt](../structured-study-import-slice-a-2026-10-03/final-hashes.txt) identifies the final PR files and excludes only itself. The original 92-entry receipt remains in the implementation evidence; no reviewed receipt or historical report/verification bytes were overwritten.

Codex repeated no frontend/build/Rust/mutation matrix in this documentation re-review. Prior independent focused and mutation checks, and Gemini-reported full local verification, are attributed separately in the acceptance. The containing source PR supplies exact-head required CI and merge evidence.
