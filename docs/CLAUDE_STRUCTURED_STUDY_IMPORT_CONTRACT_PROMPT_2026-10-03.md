# Claude: prepare the structured study-import contract and executable examples

Continue Her Flight Deck in the Mac clone, `/Users/rickymac/code/Flight-training-`. Start only after the accepted readiness-preparation PR has passed required CI, merged and the checkout is clean and synchronized with main. Create `codex/structured-study-import-contract` from that exact main commit. Read STATUS, the project handoff, the readiness acceptance, ROADMAP, the M2 design, the open-source adoption plan/research and the saved-guide-to-test brief before editing.

This task prepares the next selected open-source feature: explicitly importing an exported study packet from an outside assistant, with validated questions and answers. The candidate libraries are Zod for validation and react-markdown for guide display. Produce a concrete reviewed contract, representative synthetic fixtures, a disposable executable proof and a staged implementation handoff. Do not adopt a production dependency or implement the product flow yet. A2 acceptance, installed-Mac evidence and the relevant M2 user check-in remain gates; preparation can proceed while they are pending.

## 1. Inspect the existing data and product behavior

Record the exact branch/base and clean status. Inspect current study-set, section, flashcard and practice-test types, sanitization and validation, database repository operations, generation replacement behavior, existing file import, saved-content display and backup/restore contracts. Use the actual code as the source of truth. Cite exact file locations and explain what is reusable versus missing. Do not assume durable item IDs or attempt history exist simply because the roadmap proposes them.

Keep three user actions distinct: importing a file as a normal Study Library material; importing an explicitly structured study packet for offline use; and explicitly asking Gemini to generate questions from a guide or file. A prose guide alone does not contain a trustworthy answer key and must not silently become a practice test. Existing Gemini behavior remains available. No Claude/Codex API integration, cloud account or automatic provider upload belongs here.

## 2. Specify a bounded, versioned interchange format

Write `docs/STRUCTURED_STUDY_IMPORT_CONTRACT_2026-10-03.md` with an accompanying machine-readable schema under `docs/contracts/`. Select one simple format and justify its fields against the existing model. Avoid several competing formats or a speculative universal importer.

Define format identifier/version, packet title, optional guide content, sections, flashcards and optional structured multiple-choice questions. Specify which combinations are valid, required fields, empty values, UTF-8 handling, exact string/array/byte limits, nesting limits and unknown-field policy. Reuse established application limits where justified; label any proposed stricter limit and its reason.

For questions define IDs, choices, answer index/key, explanation and source references. Cover missing/duplicate IDs, duplicate choices, answer keys outside the choices, unsupported question types and questions with no reliable correct answer. Distinguish an export's identifiers from future durable M2 content identity; do not create a migration or invent historical attempts. Specify deterministic normalization without silently repairing ambiguous answers.

Define source/provenance rules. Imported text is untrusted content, not an instruction to the app or an agent. Do not accept executable JavaScript, MDX, embedded commands, credentials or automatic fetch/upload directives. Unknown source page numbers must not be treated as verified citations. An external guide cannot claim to cite a local PDF page unless a later validated association establishes that relationship.

Document unsupported format versions, malformed JSON, duplicate object keys, excessive size/depth, special property names and invalid encodings. Be explicit about checks that happen before parsing versus semantic validation afterward. Error messages should identify a field/problem without echoing an entire private packet.

## 3. Define preview, confirmation and persistence boundaries

Provide a simple interaction sequence: user selects one local export; bounded reading and validation; preview with counts and warnings; explicit confirmation; bounded atomic save; usable saved content offline. Include cancellation at each precommit stage, malformed input, failed persistence and retry. No database or file writes during preview.

Decide how a future import associates with a material and whether it creates a new material or replaces existing content. State conservative defaults and identify decisions requiring later product approval. Replacement must show what changes and preserve unrelated content; a rejected or cancelled import must conserve prior data. Do not claim existing repository calls already provide atomicity if A2 or M2 operations are still missing.

Map the proposed transaction boundary to accepted/current APIs and explicitly pending APIs. Keep generation/network operations outside a write transaction. Explain stale preview handling, concurrent edits/deletion, repeated confirmation/idempotency, retry after a rejected save and postcommit refresh failure. Separate proposed persistence tests from evidence actually executable today.

Specify backup inclusion, reopening, restore into compatible versions, newer-schema rejection and future stable-identity integration. Preserve the current database driver, managed-document ownership and backup container. Any migration is a later scoped task after the required gates.

## 4. Specify safe guide rendering

Inspect the exact candidate react-markdown documentation and dependencies. Keep raw HTML and MDX execution disabled. Define allowed URL schemes, handling of links and images, relative/local paths, navigation out of the desktop webview, remote-image fetching and offline behavior. Do not allow imported Markdown to read local files or trigger provider requests.

Explain where the existing renderer is sufficient and where the candidate would improve a concrete behavior. Treat installed WKWebView/macOS 12 compatibility as unverified until tested; a browser demo or a successful Node test does not establish it. Preserve minimum OS and native PDF Open.

## 5. Build meaningful synthetic contract examples and a disposable proof

Create fixtures under `docs/evidence/structured-study-import-contract-2026-10-03/`. Use synthetic, non-operational questions such as choosing a letter or comparing invented labels; no real training PDFs, personal notes, provider keys or aviation advice is needed.

Cover at least: guide-only success with no automatic test; flashcards plus an explicit test; Unicode; supported/unsupported version; malformed input; duplicate/missing IDs; invalid answer key; excessive size/depth; hostile HTML/MDX/URLs; special object properties; cancellation and failed-save conservation as proposed adapter scenarios. Keep examples small and expected outcomes explicit. Boundary cases should sit immediately below/at/above the chosen limits rather than require huge fixture sets.

For executable validation, a disposable scratch prototype may use the exact inspected candidate package versions. Keep dependencies and node_modules confined to that scratch directory; do not modify this repository's package manifests or lockfiles. Save the prototype and commands as inert review artifacts with exact versions/hashes and license provenance. This is an experiment, not production adoption. Avoid writing a competing production validator that would later be replaced solely to adopt Zod.

Exercise the real prototype validator against positive and negative fixtures. If rendering behavior is prototyped, use the actual candidate with its safe configuration and verify malicious payload handling. Do not present a regex-only check, a hand-labelled expected table or successful JSON parsing as proof of semantic validation. Keep hypothetical persistence scenarios clearly separate from any executable fake-adapter observations and from real database integration, which this task does not implement.

Inspect exact published versions, licenses, required notices, transitive dependencies and runtime/compatibility requirements using primary sources. Record access date and whether the inspected artifact is an npm release or an upstream commit. Do not install both candidates into production, copy server components, or infer compatibility from a repository's popularity.

## 6. Produce the implementation handoff

Recommend the smallest first production slice after the gates clear. Include a proposed file/change map, APIs, error states, test matrix, rollback approach, licensing obligations and explicit acceptance criteria. Separate a validator/preview slice from persistence and from rendering if that keeps review manageable. Identify exactly where A2 acceptance, M2 identity/check-in and installed tests apply; do not imply all prerequisites are complete.

Write a copy-ready future implementation prompt grounded in the final contract, not a generic library-install instruction. It must preserve current Gemini behavior, existing study content, backup integrity and Mac/Windows support. Keep MiniSearch's no-go, conditional virtualization, the later embedded viewer and FSRS outside this scope.

Update STATUS and the project handoff with completed contract preparation and remaining decisions. Do not revise historical evidence into acceptance or mark Mac checklist outcomes passed. Do not repeatedly probe unavailable A2 source, owner accounts or unchanged signing prerequisites. If an owner decision remains missing, make a conservative proposal, flag it and finish the independently useful package.

Run the prototype's relevant focused checks, schema/fixture consistency, link validation and diff checks. Do not repeat unchanged application/Rust matrices, create heavy PDFs, build installers, mount/launch apps, provision signing material or contact a live provider. Leave repository changes uncommitted and unpushed for Codex review.

Final handoff: branch/base and exact file inventory; current-model findings; final contract and decisions; exact candidate versions/licenses; actual prototype commands/results and limits; fixture and file hashes; proposed future implementation slices; remaining gates; confirmation that no production dependency, application behavior, migration, release identity, credential or real user data changed. Stop after delivering the complete package.
