# Independent M2 practice-session scope review evidence

Baseline main: 1f5ea3e4db6e66b8c1a7dfee236d43e0a3cb22b6. Submitted path: /Users/rickymac/code/Flight-training-pr70-integration/docs/M2_PRACTICE_SESSION_SCOPE_2026-10-04.md.

submitted-scope.md.txt is a byte-identical frozen copy, SHA-256 b6f036757d91b24ae971d47a00c05bcd1c28b9c3437e9349517a01ad8418717c. The local draft remains uncommitted and unchanged.

schema-observations.json records an independent Python sqlite3 :memory: execution of the proposed SQL with foreign keys enabled, using only synthetic records. It shows:
- two active versions for one material;
- a response whose question belongs to a different version from its completed attempt;
- conflicting selected-index/dont-know/is-correct state;
- full question/response/version retention, still marked active, after material deletion;
- no foreign-key violations.

These demonstrate missing planning invariants and a retention mismatch, not a bug in existing application code. An implementation may enforce some rules in transactions, but the proposal must define those rules. reproduce-schema.py reproduces the observations from the frozen proposal. Command: python3 docs/evidence/m2-practice-session-scope-review-2026-10-04/reproduce-schema.py. Expected exit 0.

Only document/source reads, whitespace checks and this disposable schema diagnostic were run. No production migration, app launch, full frontend/Rust test matrix, owner profile or release work.

[Review](../../M2_PRACTICE_SESSION_SCOPE_REVIEW_2026-10-04.md) · [one active correction prompt](../../M2_PRACTICE_SESSION_SCOPE_CORRECTIONS_PROMPT_2026-10-04.md).
