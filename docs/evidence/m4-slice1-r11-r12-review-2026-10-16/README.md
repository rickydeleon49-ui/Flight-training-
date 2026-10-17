# M4 Slice1 R11–R12 review evidence

Published source reviewed: c234005185250f14b2f67bf5d977a5b67b853126. `submitted-snapshot.json` freezes93 changed published paths; it does not assert anything about Claude's ongoing unpublished terminal work.

Place `frozen-retired-followup.test.ts` beside `src/state/navigation/useDocumentNavigation.ts` and `frozen-badge-ownership.test.ts` beside `src/pages/StudyLibrary/navigation/SourcePageBadge.tsx`, using new `.review.test.ts` filenames in a disposable matching checkout. Run those two files with Node22/Vitest. Expected current result:3 new failures and1 positive control pass, exit1. Repositories/inspection/opener are deterministic test stand-ins; the real hook, badge and controller are exercised. No file/reader/profile/provider is used. No timer sleeps.

`previous-and-focused.log` contains179 passing existing author tests,12 passing old frozen checks and1 selector failure in a copied control: global guidance-text lookup now sees both the panel and badge message. The unchanged repeat also fails that selector and is retained. `frozen-control-adaptation.txt` records the correction: scope only that control's text lookup to its clicked badge. `previous-frozen-adapted.log` then has13 passes. No previous regression assertion or product source was weakened/changed.

`ci-verification.json` and `ci-excerpt.log` identify successful exact-head CI38988724371. The full raw CI log is available at its GitHub Actions URL and retained locally under `/Users/rickymac/.codex/task-recovery/m4-slice1-r11-review-20261016/exact-head-ci.log`; the tracked file is explicitly an excerpt. New regression receipts are complete.

Tests ran only in a separate reviewer checkout with its own Vite cache path; the runtime config changes only that cache directory. Existing installed dependencies were reused. Reviewer-added tests/config/dependency symlink were removed afterwards. The active implementer's source, terminal, primary dirty settings and all app/profile/release files were left alone.
