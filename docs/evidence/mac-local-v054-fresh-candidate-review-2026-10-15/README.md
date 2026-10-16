# Independent fresh-candidate review

Entry point: docs/MAC_LOCAL_V054_FRESH_CANDIDATE_ACCEPTANCE_2026-10-15.md.

artifact-review.json records independently executed signature, architecture, ZIP, mounted-image and cleanup checks. initial-review-metadata-check.json preserves the reviewer's wrong read-only-key assumption; corrected checks use this macOS's actual Writable flags. helpers.txt, lock.txt and gate.json record the independent26-helper/lock/browser commands. browser-review.mjs is the exact outside-source copy with fresh port19433; browser-results.json and medical PNGs record17/17 synthetic browser scenarios.

replay-report.* is the literal documented12-stage helper-component proof from report-metadata commit1b31738, after updating the current20-file inventory. All22 replay-overlay paths remain unchanged in the final inventory-only commit. This does not rebuild or change the candidate, which stays frozen at e928601. The containing PR closeout records final exact-head CI and merge identities. Raw stdout formatting is preserved.

The current source-manifest.json/SHA256SUMS inventory this PR delta; original submission identities are preserved in commit8a304ba. No app/installer/ZIP binary enters Git. No desktop launch/install, real profile, hfdtest or public release acceptance.
