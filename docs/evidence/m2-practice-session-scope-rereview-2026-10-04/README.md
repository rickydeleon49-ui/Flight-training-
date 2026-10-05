# M2 practice-session proposal re-review evidence

This is proposal evidence, not an application test or an installed Mac result. Read the [focused re-review](../../M2_PRACTICE_SESSION_SCOPE_REREVIEW_2026-10-04.md) and [next assignment](../../M2_PRACTICE_SESSION_SCOPE_FINALIZATION_PROMPT_2026-10-04.md).

- `submitted-scope.md.txt`: byte-identical 426-line revised proposal, SHA-256 `b7c14382344fd53ff1178bbfb682bdebe9c02e96e7253cbde7eb35483db22dc8`. Its status/closure claims and broken source links are preserved as submitted, not endorsed.
- `reproduce-schema.py`: extracts its SQL block, creates only disposable in-memory SQLite databases with foreign keys enabled, and checks the revised constraints/deletion lifecycle plus remaining SQL coverage and legacy-marker gap.
- `schema-observations.json`: independent output, including the preserved completed-history lifecycle, accepted NULL choice/cross-version UPDATE/two in-progress attempts, startup reconversion selection/conflict and lack of a sketched receipt field.
- The minimal schema-10 fixture mirrors current basic-table/ceiling predicates and proposed unconditional new-table presence checks only. It is not a complete historical archive or executed Rust restore test.
- `verification.txt`: bounded checks and their actual outcomes. `SHA256SUMS` covers evidence files, excluding itself.

Reproduce with `python3 reproduce-schema.py` from this directory. The script reads only the frozen proposal and opens SQLite `:memory:` connections. It does not open the app, application database, browser storage or user documents. The sketch may enforce some constraints in future transactions; accepted SQL states identify where the contract must do so, not defects in shipped code.
