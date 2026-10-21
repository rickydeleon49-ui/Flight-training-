# HW-01a documentation receipts — 21 October 2026

Codex implements; Claude independently reviews, tests and merges. All work remains uncommitted.

- `manifest-rebind.txt`: EXIT 0; existing rebinder verified 20 manifest entries and 21 checksum entries. Only current ROADMAP bytes and manifest timestamp/hash bindings changed; historical execution receipts remain untouched.
- `schema14.txt`: EXIT 1; 25 passed, 1 failed, 0 skipped. The operator refusal assertion at `scripts/mac-schema14-profile-snapshot.test.mjs:292` expects stderr to begin `REFUSED: `, but sandbox `sysmon`/`pgrep: Cannot get process list` errors precede that refusal. Claude must rerun outside the sandbox. No helper/test changes were made.
- `diff-check.txt`: EXIT 0; `git diff --check` through the required receipt runner.

The runner prepends Node 22 to PATH. This round adds only the Homework proposal, AGENTS/ROADMAP notes, manifest rebinding and these receipts. Migration 0020, implementation, new tests and owner decisions remain pending. Existing untracked `node_modules` was preserved. No git writes, dependency installs, network/provider calls or real training data were used.
