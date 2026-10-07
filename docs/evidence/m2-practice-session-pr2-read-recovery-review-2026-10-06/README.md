# Independent M2 PR2 read recovery review — 6 October 2026

- `controller.txt` and `codex-pr2-completion-review.test.ts`: frozen21-case controller diagnostic unchanged from main, plus permanent affected suites:160passed,exit0,zero unhandled. R11–R13 verified.
- `material-read.txt` and `codex-pr2-material-read-review.test.ts`: two deterministic MaterialDetail metadata read refusals,2failed assertions/2unhandled rejections,exit1. Each real component read is failed independently against disposable Node SQLite. A correctly implemented equivalent visible read-retry label may replace the diagnostic selector.
- `results.json`: exact commands/process exits and source_unchanged=true. Temporary files removed from implementation src afterward.
- `source-hashes.json`:29 repository-root-relative entries verified against implementation source before/after; separate from this directory's evidence hashes.
- `submitted-diff.patch` / `submitted-new-source/`: frozen tracked diff from base61031d4 plus five untracked source files, reference only. Do not apply over dirty source.
- `submitted-completion/`: byte-preserved28-file finishing pack, all28 hashes independently verified. Full2556frontend/4skip/zero-unhandled and391native/6ignore are submitted receipts, not rerun here. Failed full receipts remain failures.
- `preserved-partial-run/`: earlier competing run's incomplete evidence copied without changing its implementation-root directory. It is historical submitted material, not independent passing verification.
- `SHA256SUMS`: evidence hashes relative to this directory, excludes itself. Contains nested original manifests as ordinary evidence files.

Toolchain: scoped Node22 and Rust stable PATH; SDKROOT MacOSX26.5.sdk. No full matrix/native rerun was needed for the unchanged native source while the new metadata read defect was reproduced. Five native erasure passes remain available in the previous controller review evidence.

Raw logs/patches remain byte-preserved using evidence-scoped whitespace attributes. Source and authored-document hygiene is checked normally. No real profile, network/provider, app launch, installed/VoiceOver or release verification occurred. Application source stays unchanged/uncommitted; only review and one next assignment are published.
