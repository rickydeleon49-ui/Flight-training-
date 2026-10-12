# Independent M3 scope/prototype acceptance

**ACCEPT corrected scope/prototype package for publication.** Production implementation still requires owner approval of M3-D1–D9. No production source or migration registration is included.

190 submitted path hashes, 57 latest-pack checksums, 60 current-scope checksums, 7 document hashes and 30 production anchors verify. Six interrupted-checkpoint paths changed: five documents and one test; prototype/native/fixture sources and the original 14 interrupted evidence files remain unchanged.

Independent final checks in `/tmp/hfd-m3-final-review`: 192 prototype tests / 3 opt-in skips, strict typecheck, 8 native tests on a fresh target, exact frozen diagnostics 7 TS/UI + 2 native, all exit 0. Seven independently sampled sensitivity variants all caught behavioral failures, with hash-checked restores.

Commands: Node22 Vitest `run --config docs/evidence/m3-skills-evidence-scope-2026-10-10/vitest.config.ts`; TypeScript `--noEmit -p` the adjacent tsconfig; Rust `cargo test --offline --locked --manifest-path` the scope pack's `native/Cargo.toml` with scoped rustup PATH and a fresh CARGO_TARGET_DIR. Exact frozen re-review diagnostics were copied to scratch tests only and run as the two named Vitest files and native `--test rereview_diagnostics`.

Independent sensitivity imports the submitted `scripts/run_remaining_sensitivity.py` in a disposable copy and selects R8-1/R8-3/R8-4/R9-1/R9-N1/R10-3/R10-6; all named controls pass, all seven variants are caught, all restores hash-match. The submitted full set reports 17 decisive variants caught, one uncounted survivor. Do not interpret that survivor as a general React timing equivalence theorem.

`submitted-hashes.json` describes the frozen submission. Publication adds acceptance headers to ROADMAP/STATUS/handoff; use `submitted-documents/` for those three original hashes. Other submitted paths are published at their original locations. Earlier manifests are historical and do not describe newer source bytes.

New independent output copies normalize trailing display whitespace and surplus final blank lines only; originals in scratch and all submitted evidence stay untouched. The submitted raw Vitest 04a receipt's trailing spaces are explicitly preserved. `SHA256SUMS` covers this review pack except itself.

UI evidence remains jsdom; native production writer/readers are unbuilt; candidate0014 stays unregistered; G1–G3 remain deferred/unexecuted/unverified and post-receipt recovery blocked/source-covered.
