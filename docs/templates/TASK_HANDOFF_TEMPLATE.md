# Task handoff — TEMPLATE

Copy to a dated task note under docs. This template contains no completion or test evidence.

## Identity and ownership

- Task / date / active implementer / independent reviewer / Git coordinator:
- Machine and OS / relevant hardware / toolchain:
- Repository remote / branch / base SHA / exact tested head or diff identity:
- Code availability: LOCAL UNCOMMITTED / PUSHED BRANCH / MERGED (choose accurately):
- PR URL and head SHA, if available:
- Other active task/branch owners checked:

## Scope and state

- Concrete problem and intended resulting behavior:
- Completed changes and root cause:
- Remaining failures/blockers and next action:
- Important data, migration, security and platform boundaries:
- Relevant STATUS, ROADMAP, design and Mac checklist links:
- Exact upstream version/commit, license/notice and copied-file provenance, if applicable:

## Verification receipts

| Exact command | Tested source/diff | Exit / counts | Shared sanitized log or summary path |
| --- | --- | --- | --- |
| Focused tests for each task/change | | UNVERIFIED | |
| Meaningful regression / negative control | | UNVERIFIED | |
| Final required local matrix | | UNVERIFIED | |
| Platform build and actual installed test, separately | | UNVERIFIED | |

Include earlier failed attempts, actual corrections and conditional skips. Passing old logs cannot prove changed source. Do not combine results from different commits without labeling them.

For performance: dataset/file size/pages, hardware/OS, build mode, timing domain, repeat distribution, memory, bundle size and before/after identity. For installers: exact filename/byte size/SHA-256, tested source, signing assessment and installed behavior separately.

## Cross-machine continuation

- All required docs/fixtures/scripts are tracked or linked:
- Any required source still local and unavailable to the other machine:
- Protected raw logs intentionally not shared; what sanitized evidence is available:
- Detailed next prompt (repo-relative links, bounded tasks, per-task tests and final gate):
- No commit/push/merge/release yet, or exact approved Git outcome:

Update `docs/PROJECT_HANDOFF.md` and STATUS. Preserve local-first testing and independent Git ownership. Do not upload credentials, real databases/documents, generated large binaries or vendor trees; do not mark an unrun platform test passed.
