# M2 card-review scope independent review evidence — 6 October 2026

[Review](../../M2_CARD_REVIEW_SCOPE_REVIEW_2026-10-06.md) and [active correction assignment](../../M2_CARD_REVIEW_SCOPE_CORRECTIONS_PROMPT_2026-10-06.md).

- `submitted-proof.txt` / `.exit`: independent original proof, 27 passed, exit 0.
- `diagnostics.txt` / `.exit`: five targeted failures, exit 1; material due-query contradictions and reset model flaws.
- `card-scope-review.test.mjs`, `portable-diagnostics.txt` / `.exit`: portable baseline, frozen to `submitted/evidence/proof`; reproduces the same five failures. Bad query is intentionally embedded as submitted. This baseline is not an unchanged pass-after gate.
- `submitted/repository/`: four original proposal/status files, byte-identical. `submitted-hashes.json` names this snapshot root.
- `submitted/evidence/`: original 16 evidence files and scoped attributes, node_modules excluded. Its original SHA256SUMS remains unchanged.
- `npm-version.json`, `upstream-result.json`, `upstream-LICENSE.txt`: independent official package/version/integrity/license verification. Signature provenance and installed WebKit remain unverified.
- `publication-hashes.json`: repository-root hashes of the published draft, review, prompt and new status entries; separate from frozen submission hashes.
- `SHA256SUMS`: this evidence directory's checksum root, excluding itself.

No production application files or dependencies change. Tests use in-memory SQLite and the submitted pure model; they do not establish actual native writes, installed behavior or an application erasure breach. The original dirty Mac preparation checkout is preserved unchanged.
