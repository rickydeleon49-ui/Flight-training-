# v0.5.4 final candidate (fbff255) — evidence

Report: [`../../MAC_V054_FINAL_CANDIDATE_REPORT_2026-10-15.md`](../../MAC_V054_FINAL_CANDIDATE_REPORT_2026-10-15.md).

- **Top-level files:** first session (build, packaging, helper checks, install, first launch). They are unchanged by the second session.
- **`installed-run/`:** second session (16 October 05:57–06:05 UTC):
  - `observe.py`, `summarize.py`, `compare.py`: the tools used;
  - `observations/`: raw observer logs (`*.jsonl`, about 0.15 s samples with UTC ms timestamps) and their summaries;
  - `comparisons/`: offline restore comparisons, including the kept first schema-14 file with my wrong seed query;
  - `screenshots/`: native screenshots of synthetic data;
  - `fixtures/`: fixture hashes and manifests (not the archives);
  - `profile-handoff.txt`: the default-profile move and return record.
- **Not in Git:** no profile, database, archive, key or binary.

Check: `shasum -a 256 -c docs/evidence/mac-v054-final-candidate-2026-10-15/SHA256SUMS` from the repository root.

Notes:

- **Overlapping logs:** each observer ran for a fixed window (15–120 s), so a log can include later events. For example, `r12.jsonl` also covers the Data Recovery launch, and `r13.jsonl` covers the next relaunch and the start of the schema-12 restore.
- **Trailing whitespace:** first-session raw outputs (`helper-lock-checks-first-failed.txt`, `launch-and-identity.txt`, `native-build.txt`, `native-install.txt`, `package-identity.txt`) keep their original bytes, including trailing whitespace reported by `git diff --check`.
