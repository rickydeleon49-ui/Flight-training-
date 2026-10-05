# M2 planning acceptance evidence

Read the [planning acceptance](../../M2_PRACTICE_SESSION_SCOPE_ACCEPTANCE_2026-10-04.md) and [canonical scope](../../M2_PRACTICE_SESSION_SCOPE_2026-10-04.md). This evidence is documentation/proposed-schema verification, not production implementation or installed testing.

- `submitted-scope.md.txt` preserves the implementer's 550-line draft, SHA-256 `b284c4e6f74369bd6caa065066d6e4346c60c92f6578ebe6e9e01592e3e89a1d`.
- `reviewed-scope.md.txt` is byte-identical to the canonical published scope, including attributed reviewer amendments. `reviewer-amendments.json` (a JSON-encoded unified diff) shows every change from the submission.
- `diagnose.py` executes the SQL extracted from both snapshots in SQLite `:memory:` with FK enforcement, checking the corrected constraints/deletion policy and added revision/history/receipt-tombstone behavior. It parses the JSON examples; it does not implement/reproduce production commands or archive restore.
- `observations.json` records 9 submitted and 12 reviewed schema checks and 10 valid JSON examples per snapshot. `verification.txt` records the actual bounded checks; `SHA256SUMS` covers evidence excluding itself.

Reproduce with `python3 diagnose.py` in this directory. All databases are in memory. The frozen submitted document's status/claim text remains historical; the canonical scope and acceptance define the reviewed plan and pending owner decision.
