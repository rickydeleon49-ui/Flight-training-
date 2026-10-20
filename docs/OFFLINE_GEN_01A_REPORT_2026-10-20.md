# GEN-01a implementation — 20 October 2026
Codex implements; Claude reviews/tests/merges. Base `bfa86d1`, branch `codex/offline-gen`; ff explicitly skipped. Everything uncommitted.
Pure, serializable candidates only; no command, persistence, migration, dependency, UI, real PDF, key, or provider request added.
`ALGORITHM_VERSION = 1`; provenance: “Pulled from your PDF on this Mac”.
Input binds every page to the exact lowercase SHA-256/current extractor version and actual caller-supplied PDF page count (1–1,000).
Duplicate page indexes are refused together; only Text outcomes participate. Image, unreadable, failed, other and ambiguous skips have separate counts.
Raw UTF-8 byte offsets/quotes remain unchanged; NFKC/case/whitespace matching uses a separate mapped view. Sort page/offset/rule; normalized prompt+answer dedup retains evidence.
Glossary: whole-line colon/em dash/means/is defined as; 2–80 raw-character terms, definition ≤500 chars and 1–2 complete sentences; no completion from knowledge.
Sentence guard: punctuation-terminated physical-line spans, ≥2 alphabetic word tokens, alphabetic start; incomplete fragments and colon/table spans are refused.
Acronyms: explicit adjacent parenthetical forms only, 2–10 uppercase ASCII letters, matching full or stopword-filtered initials; conflicting term expansions suppressed across eligible pages.
Cloze: exactly one known term/acronym or numeric span per card; signed/comma/decimal/range/percent values, all listed units, attached units and AGL/MSL stay literal.
Numeric qualifiers: at or below/above, no more/less than, at least/most, less/more than, below/above, approximately/about/up to (case-insensitive matching, raw answer).
Outline: validated local/named bookmark destinations, then numbered/short title-case heading lines, then contiguous ≤5-page text ranges; at most two literal source sentences per section.
No prior bookmark helper exists at this head. New in-memory reader bounds outline/name traversal at 256 nodes, page tree at 4,000 nodes, depths, reference chains and cycles.
Conservative text-layout guards refuse tabs, pipes, interior double spaces, dot leaders, bullets, replacement/control characters; repeated short boundary headings are omitted.
Bounds: 128 KiB/page, 8 MiB processed text, ≤1,000 supplied pages. These text heuristics do not prove original PDF layout or grammatical/aviation correctness.
Caps: 40 glossary/definition (including acronym), 40 cloze, 40 outline, 20 questions; never fill quotas. Term clozes use the first 40 accepted glossary terms.
Questions: 2–4 deterministic same-pattern answers, exact source answer/index plus evidence for every choice; substring-overlapping alternatives or conflicting stems produce no question.
Golden vectors (synthetic text/in-memory PDF object graphs only):
- glossary_colon_dash_and_sentence_forms
- acronym_explicit_only_and_conflicts_suppressed
- number_unit_cloze_keeps_qualifiers_and_ranges
- outline_bookmarks_then_headings_then_page_ranges
- ambiguous_multicolumn_tables_and_image_pages_emit_nothing_fabricated
- questions_use_only_in_pdf_distractors_or_fall_back_to_cards
- repeat_same_bytes_same_candidates
- caps_are_enforced_without_quota_filling
- pdf_kit_module_has_zero_network_imports
- label_is_pulled_from_your_pdf_never_ai_or_verified
- identity_page_bounds_and_unicode_raw_offsets
- unsafe_fragments_duplicate_pages_and_question_stems_are_refused
- matching_view_preserves_nfkc_and_combining_mark_evidence
- named_destinations_and_malformed_or_cyclic_trees_are_bounded
- numeric_units_signs_decimals_and_bounds_are_literal
Receipts: `docs/evidence/offline-gen-01a-2026-10-20/`; real exit codes via the supplied receipt runner and required cargo environment.
`red.log`: EXIT 101 (missing module); `red-vectors.log`: EXIT 101 (2 passed/9 failed against empty engine).
`focused-1.log`: EXIT 101 (10/1, overlap); `focused-2.log`: EXIT 101 (13/1, combining term); `focused-3.log`: EXIT 0 (14/0).
`focused-final.log`: EXIT 101 (14/1, leading decimal); `focused-final-2.log`: EXIT 0 (15/0). Each defect fixed on its first correction.
`cargo-full-pre-final.log`: EXIT 0 (955 passed/0 failed/11 ignored), superseded by final-tree runs below.
`cargo-full-1.log`, `cargo-full-2.log`: each EXIT 0 (956 passed/0 failed/11 ignored), --locked --no-fail-fast, default parallel mode, final source tree.
`fmt-apply.log`, `fmt.log`, `fmt-final-apply.log`, `fmt-final-apply-2.log`, `fmt-final.log`: each EXIT 0.
`clippy.log`: EXIT 0 (--locked --all-targets, -D warnings); `cargo-lock.log`, `cargo-lock-unchanged.log`: each EXIT 0.
`npm-test.log`, `build.log`: each EXIT 1, solely Vite temp-config EPERM via preserved shared node_modules symlink.
`npm-test-runner.log`: EXIT 0 (197 files passed/4 skipped; 4,143 tests passed/6 skipped); default timeouts, only authorized configLoader fallback.
`typecheck.log`, `build-runner.log`: each EXIT 0; build has existing bundle-size warning. No installed-app or live-source claim.
`diff-check-attempt.log`: EXIT 1 (wrapper treated the expected --no-index difference status as failure; no whitespace diagnostic).
`diff-check.log`, `untracked-whitespace.log`: each EXIT 0 (tracked and explicit untracked source/report whitespace checks).
Changed implementation SHA256:
- `src-tauri/src/lib.rs`: `ac8b9cebd0e428c9c0cc266d5524a832bdb0814079d20eef2352479b20b237d0`
- `src-tauri/src/pdf_study_kit.rs`: `29927af7d1d1fb150c870cfd9eb6dc6769e31885cc8ceeec18337fdd952edaac`
- `src-tauri/src/pdf_study_kit_tests.rs`: `a7f381872314cddcd17c53ded7e50cebbbb954f4ee52ddb23416a98fc2afb148`
All delivered source/report/evidence hashes: `docs/evidence/offline-gen-01a-2026-10-20/SHA256SUMS` (manifest excludes itself).
The future command must bind the optional in-memory outline document and actual page count to these same content bytes; this pure engine performs no file reads.
Stopped for Claude review; no commit, merge or publication performed. Existing node_modules symlink preserved.

## Correction r1
Added only `distractors_never_mix_patterns`: synthetic definitions, acronyms and number clozes; every choice matches its source pattern and every available pattern produces a question.
`correction-r1/mix-patterns-mutant.log`: EXIT 101, new test rejects an acronym expansion in a definition question when the pattern guard is disabled.
Guard restored exactly; implementation SHA256 remains `29927af7d1d1fb150c870cfd9eb6dc6769e31885cc8ceeec18337fdd952edaac`.
Receipt gates in the same evidence subfolder: `focused-final.log` (16 passed), `fmt.log`, `clippy.log`, `diff-check.log`: EXIT 0.
All work remains uncommitted for Claude review; concurrent documentation and manifest edits left alone.
