# Schema14 continuation evidence — 15 October 2026

Current submission: implemented, pending independent review. Start with [reviewer handoff](../../MAC_SCHEMA14_COMPLETION_REVIEWER_HANDOFF_2026-10-15.md).

- `baseline.json`: observed continuation baseline, saved-package identity verification and local recovery archive identity.
- `execution-receipts.json`: exact commands/runtime/cwd/stdout/stderr/exits and hygiene result.
- `proof-receipt.json`: all 12 proof stages and sensitivity outcomes.
- `RUNBOOK.md`: the one current canonical future walkthrough. No physical step executed; v0.5.4/local unsigned selected, installer unavailable.
- `source-manifest.json`: current submission sizes/hashes, generated after source/docs and receipts.
- `SHA256SUMS`: repository-relative checksums, generated last, includes source manifest and never itself. Verify from repository root.

The neighboring October 11 evidence pack and report are preserved historical saved-work evidence. Its old source manifest includes the original proof and handoff identities, not the current checkout. New measurements here supersede current conclusions; they do not rewrite any earlier pass/fail receipt. No application code, migration, dependency, installer, profile or provider change.
