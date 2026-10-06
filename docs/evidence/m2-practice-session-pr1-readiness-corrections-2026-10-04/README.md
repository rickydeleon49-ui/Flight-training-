# M2 PR1 completion evidence

All databases, browser stores and values are synthetic. No app launch, real profile, provider call, installer or release was used.

The previous implementer supplied `fail-before/`, `focused/` (1,577 frontend and 177 native passes), and `mutations/` (12 mutations killed, source restored). These are preserved submitted receipts, not newly rerun claims. The shared fixture contains 40 accept/refuse cases evaluated independently by native and actual sql.js validation; aggregate test counts do not count each case as a separate test.

Codex finished the actual sequential gate in `completed-gate/`: typecheck; 2,498 frontend passes/4 skips; build; 386 Rust passes/6 ignored; Clippy; fmt; actual Cargo-lock synchronization; and migration consistency all exit 0. The extended whitespace checker returned 1 due to raw logs and Markdown hard-break whitespace in old local evidence folders; the tracked source check returned 0. No source whitespace failure occurred. That failed attempt is preserved. Only the current correction evidence is published; earlier evidence remains on main in the prior review snapshots and in the preserved implementation checkout. The final integration staged whitespace check is recorded separately, with narrowly scoped attributes preserving raw receipt bytes.

`source-hashes.json` maps all 26 changed/new application files, relative to repository root. Codex copied these exact tested bytes onto current main for integration. `SHA256SUMS` maps this evidence directory (excluding itself). Validate with `shasum -a 256 -c SHA256SUMS` from this directory. Earlier fail-before runners intentionally refer to their frozen source hashes and are historical reproductions, not commands to overwrite the accepted implementation.

No previously shipped migration 1–10 or dependency/lockfile changed. Source-only acceptance does not claim real installed macOS/VoiceOver, signing, notarization or release verification. The old UI remains unchanged; PR2 is the next assignment.
