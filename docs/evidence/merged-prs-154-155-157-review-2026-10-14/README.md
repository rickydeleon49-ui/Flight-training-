# Independent review receipts — PRs #154, #155, #157

Reviewed source: `cb0ece14239e4bacbd845642329ba47e98fe1d13`.

- `verification.json`: exact commands, exits, counts, source and separately verified CI identities.
- `focused-tests.txt`: reviewer-run 10 suites / 110 passing tests.
- `build.txt`: reviewer-run TypeScript check and Vite build, exit 0. Existing externalization, annotation and mixed-import warnings are preserved.
- `reviewed-files.sha256`: hashes of all 16 files changed across the three PRs. Check from the repository root with `shasum -a 256 -c docs/evidence/merged-prs-154-155-157-review-2026-10-14/reviewed-files.sha256`.
- `SHA256SUMS`: receipt checksums; check from this directory with `shasum -a 256 -c SHA256SUMS`.

Logs replace only the review checkout root with `<review-checkout>` for publication. No suite, expectation or production source was modified. Native/full-suite CI results are not presented as local reviewer runs. This is source-level evidence, not installed Mac or release acceptance.
