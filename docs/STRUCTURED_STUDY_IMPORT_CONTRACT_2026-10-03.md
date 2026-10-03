# Structured study import contract: `hfd-study-packet` version 1 (proposed, corrected)

Prepared by Claude on the Mac, 3 October 2026, on branch `codex/structured-study-import-contract` from clean `main` `8fb3b7fe7f8ae425b41c597549f930e1aadb326a` (PR #56). Assignment: [Claude structured study-import contract prompt](CLAUDE_STRUCTURED_STUDY_IMPORT_CONTRACT_PROMPT_2026-10-03.md).

**Status: corrected after [Codex's independent review](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/STRUCTURED_STUDY_IMPORT_REVIEW_2026-10-03.md) (R1–R4) and [re-review](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/STRUCTURED_STUDY_IMPORT_REREVIEW_2026-10-03.md) (PR #58): R1–R5 independently closed; [preparation accepted](STRUCTURED_STUDY_IMPORT_ACCEPTANCE_2026-10-03.md).** The correction map is in §8. This is not production adoption. No production dependency, application behavior, migration, release identity, credential or user data changed.

**Gates** (detailed in the [implementation handoff](STRUCTURED_STUDY_IMPORT_IMPLEMENTATION_HANDOFF_2026-10-03.md), §6):

- **Preparation** (this contract, schema, fixtures, disposable prototype): may proceed now.
- **Production Slice A** (validator and read-only reader): waits for the applicable foundation and open-source adoption gates in the [adoption plan](OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md) and the [open-source Mac handoff](OPEN_SOURCE_MAC_HANDOFF.md), **or** an explicit, documented owner exception for a narrower source-only slice. No such exception exists.
- **Slice B** (atomic save and import flow): additionally waits for accepted, published A2 conventions and the M2 real-user check-in with scoped approval.
- **Merge:** each slice needs Codex's independent acceptance and a passing exact-head required check: today that is the single Ubuntu job `Tests, types, and the data-safety guards` in `.github/workflows/checks.yml`. That check is not Mac or Windows evidence.
- **Release:** installed Mac testing (including early macOS 12 for optional Markdown), Windows app behavior and the account/signing decisions. All remain unverified.

Companion files:

- Machine-readable schema: [`contracts/hfd-study-packet-v1.schema.json`](contracts/hfd-study-packet-v1.schema.json)
- Fixtures, prototype and results: [evidence folder](evidence/structured-study-import-contract-2026-10-03/README.md)
- Implementation slices and the future prompt: [implementation handoff](STRUCTURED_STUDY_IMPORT_IMPLEMENTATION_HANDOFF_2026-10-03.md)

## Contents

1. [The current application](#1-the-current-application)
2. [The interchange format](#2-the-interchange-format)
3. [Preview, confirmation and persistence](#3-preview-confirmation-and-persistence)
4. [Safe guide rendering](#4-safe-guide-rendering)
5. [Candidate packages](#5-candidate-packages)
6. [Evidence levels](#6-evidence-levels)
7. [Decisions](#7-decisions)
8. [Review correction map (R1–R4)](#8-review-correction-map-r1r4)

## 1. The current application

Inspected on `8fb3b7f`. The code is the source of truth; the roadmap's proposals (stable item IDs, attempts, content versions) **do not exist yet**.

### 1.1 What exists

| Area | Location | Finding |
| --- | --- | --- |
| Material | `src/domain/types.ts:218-236` | `StudyMaterial` has `filePath: string \| null`. A material without a file is a valid note material. |
| Guide and cards | `types.ts:238-261`; `src-tauri/migrations/0007_ai_study.sql` | `AiStudySet`: title, summary, `sections[{heading, body}]`, `flashcards[{front, back, sourcePage}]`, sourceNotes, `provider: "gemini"`, model, timestamps. **One row per material** (primary key `source_material_id`); sections and cards are JSON text. **No item IDs.** |
| Practice test | `types.ts:263-281`; `migrations/0009_practice_tests.sql` | `PracticeTest`: title, `questions[{question, options[], correctIndex, explanation, sourcePage}]`. One row per material; JSON text. **No question IDs and no attempt history.** |
| Read mapping | `src/data/repositories/documentRepository.ts:71-101` | `jsonArray` turns malformed JSON into `[]` without saying so. Both mappers force `provider: "gemini"` (lines 87, 97) whatever the column holds. |
| Writes | `documentRepository.ts:152-168, 240-292` | `create` inserts the row, then writes tags in separate calls. `saveAiStudySet` and `savePracticeTest` are each one upsert statement with the provider hard-coded to `'gemini'` (lines 246, 278). Each statement is atomic on its own; **a sequence of them is not**. |
| Multi-row atomicity | `documentRepository.ts:313-361`; `src/data/db.ts:10-20`; `src/data/tauriDb.ts:51-56`; `src/data/sqlJsDb.ts:77` | The desktop SQL plugin uses a connection pool, so separate `BEGIN`/`COMMIT` calls can land on different connections (comment at lines 315-316). Atomic multi-row writes exist only as dedicated native operations: `save_split_materials` (`src-tauri/src/documents.rs:1210`) and `save_debrief_operation` (`src-tauri/src/debrief.rs:125`), each with a pinned connection, `BEGIN IMMEDIATE` and a busy timeout. |
| Pending atomic material saves | A2 (Windows-local, not on GitHub) | Atomic material metadata and tag saves are **not accepted or available**. Nothing here relies on them. |
| Gemini output checks | `src-tauri/src/gemini.rs:466-537, 587-610` | Study aids are parsed but not sanitized. Practice questions are filtered: non-empty text and explanation, at least 2 non-empty options, `correctIndex` inside `options`. There are no length or count limits, and duplicate options are allowed. |
| Established limits | `src/logic/aiLimits.ts:15-19`; `gemini.rs:53-63`; `src-tauri/src/pdf.rs:40` | Text files sent to Gemini: 4 MiB (`MAX_TEXT_BYTES`). PDFs: 50 MiB and 1,000 pages (`MAX_PAGES`). There are no string-length limits anywhere in the study model. |
| Ordinary file import | `src/services/documents.ts:60-80`; `documents.rs:348-397` | The webview opens the picker (PDF, PNG, JPG, WebP, TXT, MD, RTF, DOCX) and passes the chosen path to `import_document`, which copies the whole file into app storage. The file is not parsed and has no size limit. |
| Display | `src/pages/StudyLibrary/MaterialDetail.tsx:686-860`; `studyLibrary.css:168` | The guide card is titled "Gemini study assistant" (line 689), with an "AI-generated" disclaimer (lines 727, 854). Summary and section bodies render as React text in `<p class="ai-copy">` with `white-space: pre-wrap`; Markdown characters show literally and HTML cannot run. A flashcard with `sourcePage` shows "Source p. N" (lines 758-762). The guide card appears when `filePath \|\| studySet`; the test card when `practiceTest \|\| (filePath && canOfferGemini)` (lines 686, 809). |
| Gemini gating | `MaterialDetail.tsx:269`; `src/logic/aiSafety.ts:33-38` | Gemini is offered only for a material with a file that passes `checkAiSubmission`. A note material shows "This material has no file attached". `MaterialFormDialog.tsx:103` can later attach a file to an existing material, which makes "Regenerate" available. |
| Practice state | `PracticeTestPanel.tsx:1-60`; `MaterialDetail.tsx:858` | Answers and score live in React state, reset by `key={practiceTest.updatedAt}`. Nothing is durable. |
| Refresh semantics | `src/state/AppDataContext.tsx:277-312` | `mutate` returns `null` only when the write failed. A refresh failure after a successful write is reported but still returns the result. |
| Backup and restore | `src-tauri/src/backup.rs:44, 380-428`; `src-tauri/src/lib.rs:23` | Archive format 3 contains the SQLite snapshot and managed documents. Restore rejects a database whose newest migration exceeds `CURRENT_SCHEMA_VERSION` (10). Study rows are inside the database, so they are backed up with no format change. |
| Webview policy | `src-tauri/tauri.conf.json:25`; `src-tauri/capabilities/default.json` | CSP: `script-src 'self'` (no `unsafe-eval`), `img-src 'self' asset: http://asset.localhost data:`, other fetches `'self'`. The opener may open URLs only under `https://aistudio.google.com/**`. There is no `fs:` permission and no asset protocol configuration. |

### 1.2 Reusable versus missing

| Reusable as is | Missing for structured import |
| --- | --- |
| `AiStudySet` and `PracticeTest` shapes; a packet maps onto them exactly (§2.13) | A packet reader that does not copy the file into app storage, with a byte bound |
| Note materials (`filePath: null`) can show a guide and a test | One native transaction that creates the material, guide and test together |
| The 4 MiB text limit, the 1,000-page bound and the "at least two options" rule | String and array limits, identifier rules, an explicit answer key |
| Pinned native transaction pattern (split, debrief) and the sql.js adapter equivalent | A way to record that content was imported, not generated: the `provider` column is TEXT, but the TypeScript type and both mappers force `"gemini"` |
| `mutate` refresh-failure semantics | Import-specific wording: the card title, disclaimer and empty-state notice all assume Gemini |
| Backup archive, restore validation, newer-schema rejection | Durable question identity and attempt history (M2, gated) |

### 1.3 Three separate actions

| Action | What it does | Network | Practice test |
| --- | --- | --- | --- |
| **Add a file to the Study Library** (exists) | Copies any supported file into app storage as a material | None | Only if the user later asks Gemini |
| **Import a structured study packet** (this contract) | Reads one local `hfd-study-packet` JSON file, validates it, previews it and, after confirmation, saves its guide, cards and questions for offline use | **None.** The packet is never uploaded anywhere. | Only from the packet's own validated `questions` with explicit answer keys |
| **Ask Gemini to generate** (exists for files; the saved-guide variant is [a separate brief](STUDY_GUIDE_TO_TEST_FEATURE_BRIEF_2026-09-29.md)) | Sends the selected file to Google after confirmation | Yes, explicit | Gemini output, with the existing warnings |

A prose guide, whether a `.md` file or a packet `guide`, **never becomes a practice test by itself**. A packet without `questions` creates no test, and the preview says so. Gemini stays available exactly as it is; the import adds no Claude or Codex API, no account and no automatic upload.

## 2. The interchange format

One format: a single UTF-8 JSON object, identified as `hfd-study-packet` version 1. Field names follow the current model where the meaning is the same (`title`, `summary`, `sections[].heading/body`, `sourceNotes`, `front`, `back`, `question`, `explanation`). The format differs only where the model is ambiguous for outside exporters: choices carry their own IDs, and the answer is named by ID instead of a numeric index.

### 2.1 Identity and versioning

- `format` must equal `"hfd-study-packet"` and `formatVersion` must be the JSON integer `1`. Both are checked **before** the full schema, so a version-2 packet gets one clear "unsupported version" error instead of many unknown-field errors.
- `formatVersion` values `0`, `2`, `"1"` and `1.0` are rejected (`1.0` at the scan stage, §2.11).
- A future version 2 must use a new `formatVersion`. This app version rejects it and asks the user to update the app or export version 1. Version 1 never accepts unknown fields (§2.5), so additive changes also need a new version.

### 2.2 Top level

| Field | Required | Type and limit | Meaning |
| --- | --- | --- | --- |
| `format` | yes | `"hfd-study-packet"` | Format identifier |
| `formatVersion` | yes | integer `1` | Format version |
| `title` | yes | single-line text, 1–200 code points | Becomes the new material's title and the guide/test title |
| `source` | no | object (below) | Unverified provenance claims |
| `guide` | no | object (§2.3) | Prose guide |
| `flashcards` | no | array, 0–500 | Cards |
| `questions` | no | array, 0–200 | Structured single-choice questions |

`source`: `generator` (single line, ≤ 100), `createdAt` (single line, ≤ 40; stored as text, never parsed as a trusted time), `note` (≤ 1,000). All three are optional and are shown as **claims** only.

### 2.3 Guide, flashcards and questions

| Path | Required | Limit (code points) | Rendering |
| --- | --- | --- | --- |
| `guide.summary` | no | ≤ 20,000 | Markdown (§4) |
| `guide.sections` | no | 0–100 items | |
| `guide.sections[].heading` | yes | single line, 1–200 | text |
| `guide.sections[].body` | yes | 1–20,000 | Markdown (§4) |
| `guide.sourceNotes` | no | ≤ 5,000 | text |
| `flashcards[].id` | yes | identifier, 1–64 | not shown |
| `flashcards[].front` | yes | 1–1,000 | text |
| `flashcards[].back` | yes | 1–2,000 | text |
| `flashcards[].sourceRefs` | no | 0–5 items | preview only (§2.9) |
| `questions[].id` | yes | identifier, 1–64 | not shown |
| `questions[].type` | yes | `"single-choice"` | |
| `questions[].question` | yes | 1–2,000 | text |
| `questions[].choices` | yes | 2–6 items | |
| `questions[].choices[].id` | yes | identifier, 1–32 | not shown |
| `questions[].choices[].text` | yes | single line, 1–500 | text |
| `questions[].correctChoiceId` | yes | one choice ID | |
| `questions[].explanation` | yes | 1–4,000 | text |
| `questions[].sourceRefs` | no | 0–5 items | preview only |
| `sourceRefs[].label` | no | single line, ≤ 200 | |
| `sourceRefs[].page` | no | integer 1–1,000 | never a verified citation |

**Reused limits:** 4 MiB file (`MAX_TEXT_BYTES`), at least two choices (`sanitize_practice_test`, `PracticeQuestion`), page 1–1,000 (`pdf::MAX_PAGES`), and a required non-empty explanation (`sanitize_practice_test`). **Proposed stricter limits** (new; none exist in the app today) are all other string, array and identifier limits. Their purpose is to bound one displayed unit (a card, a choice, a section) so that preview, rendering and storage stay predictable. Gemini's own output is far smaller: `maxOutputTokens: 8192` for a whole guide or test (`gemini.rs:523, 664`). The 4 MiB file cap is the binding total; per-field caps alone would allow more (100 sections × 20,000 code points).

String limits count **Unicode code points after normalization** (§2.7), not UTF-16 units or bytes. JSON Schema `maxLength` counts code points too. In the prototype, 200 astral emoji (400 UTF-16 units) pass a 200 limit, and a UTF-16-length mutant fails the fixtures (`results/mutation-results.json`, M6).

### 2.4 Valid combinations

- At least one of these must be present: a guide with a non-empty `summary` or at least one section, at least one flashcard, or at least one question. Otherwise the result is `packet_empty`.
- **Guide only**, **flashcards only**, **guide + flashcards**: valid. A study set is created; **no practice test**; warning `no_practice_test`.
- **Questions only**: valid. A practice test is created; no study set; warning `no_study_guide`. The guide card then stays hidden (`MaterialDetail.tsx:686`).
- **Any combination with questions**: the test contains exactly the packet's questions, in order, with choices in order. Nothing is shuffled, added, dropped or generated.
- **Guide source notes** (corrected for review R5):
  - **Where they are saved:** `guide.sourceNotes` is saved only inside the study set. So non-empty normalized notes require a persistable study set: a non-empty `summary`, at least one section, or at least one flashcard.
  - **Rejection:** notes accompanied only by questions, or by a summary and sections that are empty after normalization, are rejected with `source_notes_without_study_set` at `$.guide.sourceNotes`. Previously they were shown in the preview and then silently dropped.
  - **Notes alone:** they never count as a guide, so a packet with nothing else stays `packet_empty`.
  - **Blank notes:** they normalize to `""` and behave as absent.
  - **Valid combinations:** notes with flashcards or a substantive guide are saved exactly as normalized.
  - **Semantics change:** this narrows what version 1 accepts by one previously accepted but lossy combination. No accepted packet's saved content changes.

### 2.5 Empty values, null and unknown fields

- **Required text** must be non-empty after normalization. `"   "` gives `empty_required`.
- **Optional text** that is empty after normalization is treated as absent and stored as `""`, matching how the current model stores missing summary and notes.
- **Optional arrays** may be empty or absent; both mean "none".
- **`null` is never accepted** (`null_not_allowed`). Leave the field out instead. This removes the ambiguity between "absent", "empty" and "unknown".
- **Unknown fields are rejected at every level** (`unknown_field`), with a redacted path and **without** the field name (§2.12). Silently dropping a field the exporter considered meaningful (a hint, a second answer, a weighting) would import something different from what the user saw in their assistant. Two families get targeted messages:
  - `directive_field_unsupported` for `actions`, `commands`, `script(s)`, `exec`, `run`, `fetch`, `upload`, `download`, `webhook`, `callback`, `instructions`, `system`, `systemPrompt`, `onImport`, `onLoad`, `html`, `mdx`, `jsx`, `apiKey`, `token` and `credentials`
  - `ambiguous_answer_key_field` for `correctIndex`, `answerIndex`, `answer`, `correct`, `correctAnswer`, `correctChoice`, `answers` and `correctChoiceIds`

### 2.6 Identifiers: export IDs are not durable identity

- **Pattern:** `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$` for flashcard and question IDs; the same with at most 32 characters for choice IDs. ASCII only, so IDs cannot hide look-alike or direction-control characters.
- **Uniqueness:** question IDs are unique among questions, flashcard IDs among flashcards, and choice IDs within their question, all **compared case-insensitively** (`Q1` and `q1` collide). A duplicate gives `duplicate_id` or `duplicate_choice_id`; a missing ID gives `required_missing`.
- **Meaning:** these IDs exist so that the answer key can name a choice and so that the in-memory preview can associate references with their items. Errors identify items by position, never by ID (§2.12). They are **export identifiers**, scoped to one packet. They are **not** M2 content identity, are not stored by the first persistence slice (decision D6), and must never be used to join to attempts, because attempts do not exist. M2's stable item IDs, when the migration is approved, will be minted by the app. An export ID may at most be kept later as a stored attribute, never returned in diagnostics. No migration and no attempt history are created or implied here.

### 2.7 Answers and ambiguity

- Exactly one correct answer, named by `correctChoiceId`, which must equal one `choices[].id` **exactly**.
- **Rejected, never repaired:**

  | Case | Code |
  | --- | --- |
  | ID not among the choices | `answer_key_not_in_choices` |
  | Matches only when letter case is ignored (`"B"` versus `"b"`) | `answer_key_case_mismatch` |
  | A number (`1`), whether 0- or 1-based | `answer_key_type` |
  | An array (more than one answer) | `multiple_answers_unsupported` |
  | Missing | `required_missing` |
  | Legacy index fields (`correctIndex` and the others in §2.5) | `ambiguous_answer_key_field` |
  | Two choices with the same normalized, lower-cased text | `duplicate_choice_text` |
  | Any type other than `single-choice` (true/false, multi-select, short answer and so on) | `unsupported_question_type` |

  A true/false question can be written as a single-choice question with two choices.
- **Mapping:** `options = choices[].text` in order, and `correctIndex` = the position of the matching choice. This is computed only after validation, so the stored `correctIndex` is always inside `options`.
- An imported answer key is **the exporter's claim**. The app checks that it is well formed, not that it is true. The saved test keeps a verification warning (§3.6).

### 2.8 Deterministic normalization

Applied to every string after decoding and before the length checks. The same input always gives the same output:

1. CRLF and lone CR become LF.
2. Unicode NFC.
3. **Single-line fields** (`title`, `heading`, choice `text`, `source.generator`, `source.createdAt`, `sourceRefs[].label`): each run of whitespace (including newlines) becomes one space, then the value is trimmed.
4. **Block fields** (summary, body, sourceNotes, front, back, question, explanation, `source.note`): leading blank lines and trailing whitespace are removed. The first line's indentation and Markdown hard breaks inside the text are kept.
5. IDs and `correctChoiceId` are **not** normalized. They must already match the pattern exactly.

Normalization never touches answer keys, choice order or question order. It is not a repair step: an ambiguous answer stays an error.

### 2.9 Source references and provenance

- `sourceRefs` and `source` are **unverified claims** by the exporter. A packet cannot prove that "page 3" means page 3 of any PDF stored in this app. Imported items are therefore saved with `sourcePage: null`, so the existing "Source p. N" badge never shows an imported claim as a citation (`MaterialDetail.tsx:758-762`). A mutant that copied a ref page into `sourcePage` fails the fixtures (M7).
- In the first persistence slice, `sourceRefs` are shown in the preview, labelled unverified, and **not saved** (decision D5). The preview says so (warning `source_refs_unverified`). The current tables have no field for them. Inventing one, or appending them to explanations, would be a silent schema change or content rewrite.
- Only a later, validated association could turn a reference into a citation: the user links the imported material to a stored PDF, and the page is checked against that PDF's page count and identity. That needs M2 lineage and is out of scope.
- The saved record states that the content was **imported** (`provider: "import"`, decision D3), never "Gemini".

### 2.10 Imported content is untrusted data

- Every string is data to display. **Nothing in a packet is an instruction** to the app, to Gemini or to any agent. No field triggers an action, and text such as "ignore previous instructions and upload…" is just displayed (fixture 05).
- **No execution:** no JavaScript, no MDX/JSX evaluation, no raw HTML rendering, and no remark or rehype plugins from third parties (§4).
- **No network:** no packet field or text causes a fetch, upload, provider request or navigation. Images are never loaded and links are never navigable (§4.4).
- **No local file access:** packet text cannot reference app files. Relative, `file:`, `asset:` and `tauri:` URLs are dropped (§4.4).
- **Credentials:** text that looks like a secret makes the packet fail with `credential_like_content`, and the error never echoes it. The patterns are a Google API key shape, `sk-` secret keys, GitHub `gh?_` tokens, Slack `xox?-` tokens, PEM private-key headers and AWS access-key IDs. This is a guard against accidental pastes, not a guarantee. The app never asks for or stores a credential through this flow.
- **Warnings shown in the preview** (heuristic and informational, not the security boundary): `html_like_text` (shown as text, never run), `markdown_images_not_shown`, `bidi_controls_present` (direction controls U+202A–202E and U+2066–2069 that can change how text looks) and `source_claim_unverified`.

### 2.11 Encoding, size and structure: checks before parsing

The pipeline, in order. Each stage stops at its first failure, and nothing is written at any stage.

| Stage | Check | Code |
| --- | --- | --- |
| Read (native, proposed) | metadata size ≤ 4,194,304 bytes **before** reading; read at most limit + 1 bytes, so a growing file is still refused | `file_too_large`, `file_read_failed` |
| Bytes | non-empty | `file_empty` |
| | UTF-16 byte-order marks rejected | `unsupported_encoding` |
| | strict UTF-8, which rejects overlong and invalid sequences | `invalid_utf8` |
| | one leading UTF-8 BOM is ignored | warning `utf8_bom_removed` |
| Scan | strict RFC 8259 grammar; nothing after the value | `malformed_json`, `trailing_content` |
| | depth ≤ 8 containers (root = 1; the format itself needs 5) | `depth_exceeded` |
| | ≤ 32 fields per object; field names ≤ 64 code points | `too_many_keys`, `key_too_long` |
| | duplicate field names in one object, compared after unescaping | `duplicate_key` |
| | `__proto__`, `constructor` and `prototype` rejected anywhere | `forbidden_property_name` |
| | numbers: whole numbers of ≤ 9 digits only (no fraction or exponent, so `1.0` and `3.0` are refused) | `unsupported_number` |
| | strings: no C0/C1 control characters except tab, LF and CR; no DEL; no lone surrogates (including through `\u` escapes) | `invalid_string_character` |
| | ≤ 250,000 JSON values in total | `too_many_values` |
| Gate | root is an object; `format`; `formatVersion` | `root_not_object`, `format_missing`, `unsupported_format`, `version_missing`, `unsupported_version` |
| Schema | Zod structural validation with normalization (§2.2–2.8) | `unknown_field`, `wrong_type`, `required_missing`, `too_long` and the others |
| Semantic | packet not empty; ID uniqueness; answer key; duplicate choices; empty source refs; credential-like text | §2.12 |

**Proposed** limits in this table: depth 8, 32 fields, 64-code-point field names, 9 digits, 250,000 values. The 4 MiB size is reused.

**Why a custom scanner instead of `JSON.parse`:** `JSON.parse` silently keeps the last duplicate key (fixture 17 passes `JSON.parse` and the schema), accepts `1.0`, and decodes `\u0000` and lone surrogates (fixtures 40-42 and 53 pass `JSON.parse` and the schema). `__proto__` handling can also mutate an object's prototype. In a mutant without the forbidden-name check, fixture 34 changed the scanned root object's prototype; Zod then happened to reject the inherited field. The scanner builds the value itself, in one bounded pass with a depth bound, and the prototype never calls `JSON.parse`. Zod's `strictObject` then rejects unknown fields; this is checked by mutant M8.

### 2.12 Errors without echoing private content

**Guarantee (corrected for review R1):** a failure result contains only fixed or numeric information. Character syntax is not treated as a privacy boundary: an identifier-shaped key or ID can still be private text or a secret.

| Property | Contents |
| --- | --- |
| `ok`, `stage`, `omittedErrors` | `false`; one of `bytes`, `scan`, `gate`, `schema`, `semantic`, `internal`; an integer |
| `errors[].code` | one fixed code from the list below; anything unexpected becomes `internal_error` |
| `errors[].message` | the fixed message for that code, never built from input |
| `errors[].path` | `$`, then only `.<name>` segments where the name is **contract-owned** (§2.2–2.3), `.<field>` for any other key (redacted), and `[<integer>]` indexes |
| `errors[].limit`, `offset`, `index`, `firstIndex` | integers only: a contract limit, a character offset in the text, an item's position, the position of the first duplicate |
| `errors[].supported` | the fixed list `[1]` (unsupported version only; the packet's own version value is not returned) |
| `errors[].field` | only a **fixed** name: a contract-owned field for `duplicate_key`, or a member of the fixed directive or legacy-answer allowlists for `directive_field_unsupported` and `ambiguous_answer_key_field` |

The rules:

- **Unknown fields:** `unknown_field` never names the field.
- **Duplicates:** duplicate items and choices are identified by `index` and `firstIndex` (for example `$.questions[2].id`, `index: 2`, `firstIndex: 0`), never by the ID value. This applies to `duplicate_id`, `duplicate_choice_id` and `duplicate_choice_text`.
- **Nothing raw:** no raw Zod issue, input value, parser exception message, file path or packet fragment is returned.
- **Unexpected errors:** an unexpected exception gives `internal_error`.

**How it is enforced:** every error passes through one boundary function. It rebuilds the error from these allowlisted parts only, re-checks each path segment against the contract-owned names, and drops every other property. The upstream stages also avoid producing private values in the first place, so a defect in one layer is absorbed by the other.

**Tests:**

- The permanent `R1:` regressions use ordinary ASCII private sentinels and credential-shaped values assembled at run time. They cover unknown keys at several depths, duplicate unknown keys, nested scan failures under unknown keys, duplicate question, card and choice IDs, and answer keys.
- Each check inspects the **entire** returned failure object: its property allowlist, path grammar, integer types, `field` allowlist and absence of sensitive values.
- Mutation results:
  - M12, M12c and M12d break both layers and are caught.
  - M10, M12a and M12b break one layer and are absorbed by the other.

At most 50 errors are reported, with a count of the rest (`omittedErrors`).

Error codes: `file_empty`, `file_too_large`, `file_read_failed`, `unsupported_encoding`, `invalid_utf8`, `malformed_json`, `trailing_content`, `depth_exceeded`, `too_many_keys`, `key_too_long`, `duplicate_key`, `forbidden_property_name`, `unsupported_number`, `invalid_string_character`, `too_many_values`, `root_not_object`, `format_missing`, `unsupported_format`, `version_missing`, `unsupported_version`, `unknown_field`, `directive_field_unsupported`, `ambiguous_answer_key_field`, `wrong_type`, `null_not_allowed`, `required_missing`, `empty_required`, `too_long`, `too_few_items`, `too_many_items`, `invalid_id`, `unsupported_question_type`, `answer_key_type`, `multiple_answers_unsupported`, `page_out_of_range`, `source_ref_empty`, `packet_empty`, `duplicate_id`, `duplicate_choice_id`, `duplicate_choice_text`, `answer_key_not_in_choices`, `answer_key_case_mismatch`, `credential_like_content`, `source_notes_without_study_set`, `invalid_value`, `internal_error`.

### 2.13 Validation result: preview data and persistence payload

Corrected for review R2 and R3. A successful validation returns **two separate things**, both built from the same validated, normalized value in one pass. The original file is never parsed again.

**1. `preview`: in memory only.** It contains the title, counts, `createsStudySet`, `createsPracticeTest` and warnings, plus:

- `preview.data` (`PacketPreviewData`):
  - `source`: the non-empty normalized claims among `generator`, `createdAt` and `note`, or `null`
  - `guide`
  - `flashcards[]`, each with `index`, export `id`, `front`, `back` and its own `sourceRefs[]` in order
  - `questions[]`, each with `index`, export `id`, `question`, `choices[{id, text}]`, `correctChoiceId`, `explanation` and its own `sourceRefs[]`
- `preview.discardedOnSave`: `{ sourceClaims: [names], sourceRefs: n, exportIds: n, choiceIds: n }`, so the confirmation can state exactly what will **not** be saved.

Every non-empty claim, including a note-only or date-only one, raises `source_claim_unverified`. An empty `source` object or blank values are not a claim.

**2. `payload`: persistence DTOs.** It is lossy by design:

| Payload field | Contents |
| --- | --- |
| `material` | `{ title }` only. Every other material field is a **fixed default supplied by the future native save command** (Slice B, `save_structured_study_import`): `materialType: "study_guide"`, `topic: "general"`, `reviewStatus: "needs_review"`, `priority: "later"`, `goalId`/`eventId` null, `notes: ""`, `filePath`/`originalFileName`/`fileSize`/`lastReviewedAt` null, no tags. A packet cannot set them. |
| `studySet` (or `null`) | `ImportedStudySetDraft`: `title`, `summary` (or `""`), `sections`, `flashcards[{front, back, sourcePage: null}]`, `sourceNotes` (or `""`), `provider: "import"`, `model: ""` |
| `practiceTest` (or `null`) | `ImportedPracticeTestDraft`: `title`, `questions[{question, options, correctIndex, explanation, sourcePage: null}]`, `provider: "import"`, `model: ""` |

Guide `sourceNotes` are never preview-only. Whenever a packet is accepted with non-empty notes, a study set exists and carries them, so `discardedOnSave` has nothing to list for them (R5, §2.4). Source claims, export IDs, choice IDs and references never enter the payload. The `R2: preview-only information is absent from persistence output` regression and mutants M13–M15 check this.

**Typing (R3):** the stored domain types keep `provider: "gemini"` until Slice B. The import DTOs therefore omit and redefine `provider` instead of reusing `Omit<AiStudySet, …>`:

```ts
type StoredOnly = "sourceMaterialId" | "provider" | "generatedAt" | "updatedAt";
type ImportedStudySetDraft = Omit<AiStudySet, StoredOnly> & { provider: "import"; model: "" };
type ImportedPracticeTestDraft = Omit<PracticeTest, StoredOnly> & { provider: "import"; model: "" };
type ImportPayload = { material: Pick<StudyMaterial, "title">; studySet: ImportedStudySetDraft | null; practiceTest: ImportedPracticeTestDraft | null };
```

The full set, including `PacketPreviewData`, `PacketPreview`, `PacketError` and `PacketValidationResult`, is in `prototype-corrected/dto-check-import-dto.ts.txt`. It compiles against the **unchanged** `src/domain/types.ts` with the repository's TypeScript 5.9.3 and its strict settings. So does the prototype's actual output for guide-only, test-only, combined and reference packets (`results-corrected/dto-check-summary.txt`). It uses no casts.

### 2.14 Example

```json
{
  "format": "hfd-study-packet",
  "formatVersion": 1,
  "title": "Invented labels practice",
  "guide": { "summary": "Quill always follows **Plinth** in this made-up sequence." },
  "flashcards": [{ "id": "c1", "front": "Which letter follows A?", "back": "B" }],
  "questions": [{
    "id": "q1",
    "type": "single-choice",
    "question": "Which label comes after Plinth?",
    "choices": [{ "id": "a", "text": "Zorb" }, { "id": "b", "text": "Quill" }],
    "correctChoiceId": "b",
    "explanation": "In this invented sequence, Quill follows Plinth.",
    "sourceRefs": [{ "label": "Invented chart", "page": 3 }]
  }]
}
```

## 3. Preview, confirmation and persistence

### 3.1 Interaction sequence

1. **Select.** The user chooses Study Library → **Import study packet…** and picks one local `.json` file in the native picker. Proposed: the picker opens in Rust and returns the bytes, so the webview never supplies a file path (§3.4).
2. **Bounded read and validate.** Size is checked before reading, then the bytes go through the §2.11 pipeline. Nothing is written to the database or to files.
3. **Preview.** The preview shows:
   - the title
   - counts of sections, cards, questions, choices and source references
   - whether a study guide and/or a practice test **will** be created, including "No practice test: this packet has no structured questions"
   - every warning
   - the source claims and each item's references, from `preview.data`, labelled unverified
   - what will not be saved, from `preview.discardedOnSave`: source claims, references, export IDs and choice IDs
   - a short read-only content preview using the same renderer as the saved view
   - the file name and the SHA-256 of the **original file bytes** (from the native reader), for the user's own reference

   Errors are listed by path and code, with no content.
4. **Confirm.** The default button is **Import as new material**. The confirmation states that nothing is uploaded and that answers come from the packet, not from the app or Gemini.
5. **Save.** One bounded atomic native transaction creates the material, study set and test together (§3.4).
6. **Use offline.** The new material opens with its guide, cards and test. No key or network is needed.

### 3.2 Cancellation, invalid input, failure and retry

| Situation | Behavior | Data |
| --- | --- | --- |
| Cancel in the picker | Nothing happens | unchanged |
| Cancel or close during read/validation | The result is discarded | unchanged |
| Cancel at preview | The preview is discarded; the bytes are dropped from memory | unchanged |
| Invalid packet | Errors are shown (codes, paths, counts); no confirm button | unchanged |
| Save fails (constraint, I/O, lock after bounded retries) | "Not imported. Nothing was changed." with **Try again** using the same preview | the whole transaction rolled back |
| Transient lock | Bounded retries (100, 300, 700 ms, reused from `documentRepository.ts:47`), then a plain failure | unchanged on failure |
| Outcome unknown (for example an IPC error after commit) | **Try again** resends the same operation; the native side reports `already_saved` instead of creating a duplicate (§3.5) | exactly one copy |
| Save succeeded, refresh failed | "Imported, but the screen could not refresh", the existing `mutate` semantics; no rollback | saved |
| App quits mid-save | SQLite rolls back the uncommitted transaction | unchanged |

The prototype's fake adapter exercises these rules (scenarios S1–S11 in `results/adapter-results.json`). Those are **fake-adapter observations**, not database evidence (§6).

### 3.3 Association: create new by default; replacement later

- **Default and only first-slice behavior: create a new material.** Importing never modifies an existing material, guide or test, so a rejected, cancelled or failed import cannot affect prior data, and no replacement disclosure is needed. Re-importing the same file creates another material; the preview and success message say so. Duplicate detection by packet hash is an optional later addition (D8).
- **Replacing an existing material's guide/test is deferred** (decision D2, needs owner approval). If approved later, it must:
  - be an explicit choice that names the target
  - show what changes: old versus new counts for sections, cards and questions; "the current practice test will be replaced"; "flashcards will be replaced"
  - leave the material's file, metadata, tags, notes, links and unrelated content untouched
  - capture a fingerprint of the target's material, study set and test rows at preview time, and abort the save if any of them changed or the material was deleted (prototype scenario S11)
  - wait for M2 if the user wants old attempts or content versions kept, because replacement currently overwrites the single row
- **Attaching a file later** (`MaterialFormDialog.tsx:103`) makes Gemini "Regenerate" available on an imported material, and today's confirmation does not mention replacement. The persistence/UI slice must add "This replaces the imported guide/test" to that confirmation for `provider: "import"` content.

### 3.4 Transaction boundary

| Step | Current, accepted API | Status |
| --- | --- | --- |
| Pick and read the packet | none suitable. `pickAndImportDocument` copies the file; there is no `fs:` capability. | **New native command needed:** `pick_study_packet`, a read-only Rust picker returning `{fileName, byteLength, sha256, text, bomRemoved}` (see the boundary below) |
| Validate and preview | none | **New** TypeScript module (Zod), pure, no I/O: `validatePacketText(text, { bomRemoved })` |
| Create material + study set + test | `create` + `saveAiStudySet` + `savePracticeTest` exist, but as three or more pooled calls they are **not atomic** on desktop | **New native command needed:** `save_structured_study_import`, one pinned rusqlite connection, `BEGIN IMMEDIATE`, busy timeout, following `save_split_materials`/`save_debrief_operation`; plus a sql.js adapter equivalent and `SqlDatabase.saveStructuredImportAtomically?` |
| Atomic material saves generally | A2 | **Pending, not on GitHub.** The new command does not depend on A2 code. It must be rebased onto accepted A2 conventions before merging, because both touch material creation |
| Provenance | `provider` column exists (TEXT) | **Type and mapper change needed:** `provider: "gemini" \| "import"`, read with an allowlist fallback to `"gemini"`; repository writes take the provider instead of hard-coding it |
| Refresh | `mutate` | reused |

The native command re-checks invariants defensively: counts and lengths within the contract, `correctIndex` inside `options`, at least 2 options, non-empty required text, `sourcePage` null and provider `"import"`. Anything else is refused. It is a guard, not a second full validator, so the two cannot drift on rules that matter for safety.

**Reader/validator boundary (R3).**

- **Native reader, original bytes:**
  1. checks the metadata size (≤ 4,194,304) before reading
  2. reads at most limit + 1 bytes
  3. computes the **original-file SHA-256** over the exact bytes read, including any BOM
  4. rejects UTF-16 byte-order marks
  5. decodes with strict UTF-8 and strips one leading UTF-8 BOM, setting `bomRemoved`
- **What crosses the boundary:** text, never bytes.
- **Pure validator:** does not trust any claimed length. It re-derives the original byte size as the UTF-8 length of the text, plus 3 if `bomRemoved`, and enforces the same 4 MiB limit. It refuses a leading U+FEFF that the reader should have stripped, then runs the scan, gate, schema and semantic stages.
- **Tests and the browser adapter:** use `validatePacketBytes(bytes)`, which applies the same byte checks itself.
- **Proof:** `R3: text entry re-derives the byte limit and refuses an unstripped BOM` covers the limit with and without a BOM, astral text whose UTF-16 length understates its UTF-8 size, and the BOM rule.

**Network operations are never inside the write transaction.** The import has no network step at all. Gemini generation keeps its existing "generate outside, save after" order.

### 3.5 Stale previews, concurrency, idempotency

- **Stale preview (create mode):** the save uses the normalized payload held in memory from the preview, never a re-read of the file. What the user saw is what is saved. If the file changes after preview, nothing is affected; a new preview is needed to import the new content.
- **Concurrent edits or deletion:** create mode touches no existing row. Deleting other materials meanwhile is unaffected. Replacement mode (deferred) uses the fingerprint check in §3.3.
- **Repeated confirmation:** a synchronous ref lock, as in the Gemini lock pattern (`MaterialDetail.tsx`), ignores a second click while saving (S6). The material ID is generated **once per preview**.
- **Idempotency:** the operation carries the pre-generated material ID and a `contentHash`. That is **not** the original-file SHA-256 shown in the preview: it is SHA-256 over the UTF-8 bytes of `canonicalPersistenceJson(payload)`.
  - **Canonical form:** a JSON array in fixed order:
    1. the tag `"hfd-study-packet-content/1"`
    2. `[material.title]`
    3. `null`, or `[provider, model, title, summary, [[heading, body]…], [[front, back, sourcePage]…], sourceNotes]`
    4. `null`, or `[provider, model, title, [[question, options, correctIndex, explanation, sourcePage]…]]`
  - **Excluded:** every preview-only value (source claims, export and choice IDs, references, warnings, counts) and the original bytes. The packet's key order, IDs and claims therefore do not change it, and a changed answer does (`R3: canonical persistence JSON ignores key order and preview-only values`). Saved guide `sourceNotes` are part of it, and changing them changes it (`R5: canonical persistence content includes saved sourceNotes and changes with them`). No database column is added for it.
  - If that material ID already exists **with the same content hash**, the native command returns `already_saved` (S7).
  - With a different hash it refuses with a conflict, and nothing changes (S10).
  - This needs somewhere to keep the hash. Proposed: the native command compares the stored study-set and test JSON with the payload instead, which needs no new column. To be decided in the persistence slice (D7).
- **Retry after a rejected save:** permitted with the same preview. A conflict is not retryable.
- **Refresh failure after commit:** reported as saved; no rollback (S8).

### 3.6 Reopening, backup, restore, newer versions, M2

- **Reopening:** imported content is ordinary rows in `study_materials`, `ai_study_sets` and `practice_tests`, so it survives restarts and works offline.
- **Labels:** the saved view must say "Imported study packet" instead of "Gemini study assistant", and carry an imported-content disclaimer: "Imported from a file you selected. Its answers and source references have not been checked by Her Flight Deck. Verify against current FAA material, aircraft documents and your instructor."
- **Backup:** included automatically, with no archive format change; the database snapshot already contains these tables. The packet file itself is **not** stored (D4), so no managed document is created and backup completeness rules for documents are unaffected.
- **Restore into compatible versions:** no migration, so the schema stays at 10 and older binaries that support migration 10 can restore such a backup. **Known limitation:** older binaries force `provider` to `"gemini"` when reading (`documentRepository.ts:87, 97`), so they would label imported content as Gemini-generated. The content itself is intact. This is a **disclosed proposed tradeoff (D3), not an accepted owner risk**: an owner decision is required before Slice B either accepts it or waits for an M2 migration.
- **Newer schema:** unchanged; restore rejects a database newer than `CURRENT_SCHEMA_VERSION` (`backup.rs:420-427`). A future packet `formatVersion` 2 is rejected at import (§2.1).
- **Future M2 identity:** when migration 11 converts `ai_study_sets` and `practice_tests` into content versions and stable items, it must keep `provider: "import"` as the source kind, mint new item IDs (export IDs are not identity), and treat imported questions like any other version. No attempts exist to convert. The database driver, managed-document ownership and backup container stay unchanged. Migrations remain a later gated task.

## 4. Safe guide rendering

### 4.1 Where the current renderer is enough

For **safety**, the current plain-text rendering is already sufficient. React escapes text, and `pre-wrap` shows the source exactly: HTML, scripts, MDX and URLs appear as literal characters and never execute or load (compared side by side in `results/render-results.json`, field `currentRendererHtml`). Cards, choices, questions, explanations, headings and source notes should **stay plain text**.

### 4.2 What react-markdown improves

Imported guides (and Gemini guides) often contain Markdown: `**bold**`, lists and headings. Shown as plain text, those markers are noise. react-markdown renders headings, lists, emphasis, code and block quotes as real structure, which helps reading and screen readers. That is the only concrete gain. It is a display improvement, not a safety one, so the rendering slice is separate and optional (handoff §2, slice C). Whether Gemini guides also switch to Markdown is a product decision (D9). The proposed default is imported guides only, leaving current Gemini rendering unchanged.

### 4.3 Safe configuration (verified with the actual 10.1.0 package)

```js
z.config({ jitless: true }); // in the validator module (see §4.5)

<Markdown
  skipHtml={false}            // default: raw HTML is shown as escaped text (verified); no rehype-raw
  allowedElements={[ "p","h1","h2","h3","h4","h5","h6","ul","ol","li","em","strong","code","pre","blockquote","hr","br","a","img" ]}
  unwrapDisallowed            // anything else keeps only its text
  urlTransform={displayUrl}   // http(s) to non-local hosts and mailto: only, and only to show as text
  remarkPlugins={[remarkDepthGuard]} // our own few-line transformer; no third-party plugins
  rehypePlugins={[]}
  components={{ a: TextLink, img: OmittedImage, h1..h6: subordinate headings }}
>{body}</Markdown>
```

- MDX is impossible because no MDX plugin is used: `import`, `export`, `{expressions}` and `<Components/>` render as text (fixture 05, verified).
- GitHub-flavored Markdown (tables, task lists, footnotes) needs `remark-gfm`, a separate dependency, and is **not** included. Tables therefore render as text. Adding it later needs its own review (D10).
- Headings inside a body render as `h5`/`h6` under the section's `h4`.
- Wrap the renderer in an error boundary that falls back to the plain-text renderer, and memoize the rendered output per saved text.

### 4.4 URLs, links, images, local paths, navigation and offline use

| Input | Result | Reason |
| --- | --- | --- |
| `[t](https://example.org/x)`, autolinks | `<span>t (https://example.org/x)</span>`: text, **not a link** | Following a link inside the Tauri webview would navigate the app window away. Opening externally would need an opener capability change, which is out of scope (D11). |
| `mailto:` | shown as text | as above |
| `http(s)://localhost`, `*.localhost` (including `asset.localhost`, `tauri.localhost`), `127.x`, `[::1]`, URLs with user:password | link text only; URL hidden | not meaningful to show; avoids implying local access |
| `javascript:`, `vbscript:`, `data:`, `file:`, `asset:`, `tauri:` and every other scheme, including entity-obfuscated and mixed-case forms | link text only; URL dropped | never navigable or shown |
| Relative (`../x`, `/etc/x`, `#a`) and protocol-relative (`//host`) | link text only | could otherwise resolve against the app origin |
| Images (Markdown image syntax with any URL) | `[Image not shown: alt]`; **no `<img>`** | no remote fetch, no local file read, no tracking. The app CSP would block remote images anyway, but `data:` and the asset origins are CSP-allowed, so the renderer must not emit `<img>` at all. |
| Raw HTML `<img onerror>`, `<iframe>`, `<script>`, `<a href>` | escaped visible text | verified |
| Offline | identical | rendering never needs the network; `fetch` was trapped during the render run: 0 calls |

No Markdown construct can read local files or trigger a provider request, because nothing in this renderer performs I/O.

### 4.5 Findings from executing the actual candidates

1. **`skipHtml: true` silently deletes content.** An HTML block takes adjacent text with it: `<script>…</script> hi` rendered as nothing. The default (`false`) shows HTML as escaped text, which is visible, inert and honest. **Use the default.**
2. **Deep nesting overflows the stack.**
   - Unguarded react-markdown threw `RangeError: Maximum call stack size exceeded` at 2,000, 2,500 and 5,000 nested block quotes (3,000 and 4,000 happened to pass in the same run), at 1,000 or more nested same-line list markers, and for 10,000-asterisk or 3,300-level alternating emphasis (`results/probe-depth.log.txt`, `probe-inline.log.txt`). All of these fit inside a 20,000-code-point body.
   - The threshold is not stable: block quotes at 2,000 passed in an earlier run and failed in the final one, and JavaScriptCore stack limits differ from V8.
   - Parsing (`mdast-util-from-markdown`) completed in every case; the recursive conversion afterwards (`mdast-util-to-hast`, React rendering) is what overflowed.
   - Mitigation, verified: `remarkDepthGuard` measures the parsed tree iteratively and, above 64 nodes deep (proposed; about 31 list levels or 60 quote levels), replaces it with the original text as one paragraph. All 23 render cases then pass, including the cases that used to overflow.
   - The guard is generic, so it also covers inline nesting. A line-prefix nesting rule in the validator was tried and dropped, because it could not see inline nesting.
3. **Parsing cost at the limit.** The emphasis-bomb bodies take about 1.0–1.7 s to *parse* in Node 22 on an Apple M5 before the guard falls back. WKWebView timing is unmeasured. Memoize per saved text, render only when a section is shown, and measure on the installed app.
4. **`Object.hasOwn` is required at render time.** react-markdown 10.1.0 calls it on every render (`lib/index.js:323, 376-377`). It first shipped in Safari 15.4 (macOS 12.3), so on macOS 12.0–12.2 WebKit the component would throw.
   - A Node capability simulation reproduced `TypeError: Object.hasOwn is not a function`, and a narrow shim fixed it (`results/legacy-webkit-sim.json`).
   - The `structuredClone` uses in `mdast-util-to-hast` go through `@ungap/structured-clone`, a polyfill.
   - Zod showed no post-15.0 API use in the static scan.
   - **The rendering slice must install an `Object.hasOwn` shim before the component loads, or keep the plain-text renderer on WebKit that lacks it.** This follows the A3 precedent for `structuredClone` and `<dialog>`.
5. **Zod under the app CSP.** By default Zod 4 probes `new Function`. Under `script-src 'self'` that is a CSP violation report even though Zod catches it; Zod's own source says so (`zod/v4/core/util.js:219`). The prototype counted 9 `Function` constructor calls with default settings and **0 with `z.config({ jitless: true })`**. Production must set `jitless` before any schema is built and must never import `zod/compile`.

### 4.6 Compatibility remains unverified

Node results, capability simulation and a static scan **do not establish** installed WKWebView or macOS 12 behavior. Installed checks needed later:

- render on macOS 12.0–12.2 (the shim path) and on current macOS
- no CSP violation when the validator runs
- VoiceOver reading of rendered structure
- parse timing at the limits

The minimum OS (12.0), native PDF Open and the PDF engine are unchanged by this contract.

## 5. Candidate packages

Inspected from the **npm registry** (`registry.npmjs.org`, published tarballs, not upstream commits) on **2026-10-03 (20:40Z)** and installed only in a scratch directory with `--ignore-scripts`. Repository manifests, lockfiles and `node_modules` were not touched.

| Package | Version | Published | License (file) | Runtime dependencies | Notes |
| --- | --- | --- | --- | --- | --- |
| `zod` | **4.6.5** (`latest`) | 2026-09-13 | MIT, "Copyright (c) 2025 Colin McDonnell" (`LICENSE`) | **none** | ESM and CJS; `sideEffects` lists `compile.*` only; integrity `sha512-v5l/aFXZ…Rsut2Q==` |
| `react-markdown` | **10.1.0** (`latest`) | 2025-03-07 | MIT, "Copyright (c) Espen Hovlandsdal" (`license`) | 11 direct; **85 packages** in its installed tree excluding React, react-dom and scheduler: 75 runtime packages, plus 9 `@types/*` and `csstype` (type-only) | ESM only; peer `react >=18` (app: 19.2.8); upstream gitHead `44d2e4a44b37461ab7778d6870c1a9eb36393ad2`; integrity `sha512-qKxVopLT…ZZFxQ==` |

- **Transitive licenses** (89 packages including React, from `results/dependency-inventory.tsv`): 88 MIT and 1 ISC (`@ungap/structured-clone` 1.4.0).
- Several `mdast-util-mdx-*` packages appear only because `hast-util-to-jsx-runtime` can *represent* MDX nodes. No MDX parser or evaluator is installed or enabled.
- `debug`/`ms` come in transitively.
- **Obligations if adopted:** keep each MIT/ISC copyright and permission notice in distributed builds (third-party notices file). There are no NOTICE files with extra terms.
- **Re-check the exact versions at implementation time.** Popularity was not used as evidence of compatibility.
- Test-only tooling, in a separate scratch directory and **not a candidate**: `ajv` 8.20.0 (MIT), for schema/fixture consistency.

## 6. Evidence levels

The first rows describe the **original submission's run** (`results/`), kept unchanged as reviewed history. The R1–R4 corrected run and its before-run are in `results-corrected/`; the R5 run and its before-run are in `results-r5/`. Codex's own reruns are recorded separately in its [review evidence](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/evidence/structured-study-import-review-2026-10-03/README.md).

| Level | What it shows | Where |
| --- | --- | --- |
| **Executable prototype: validator** (Zod 4.6.5) | 95/95: 45 committed fixtures, 49 generated boundary/encoding/privacy cases, 1 bounded-reader check | `results/validator-results.json` |
| **Executable prototype: renderer** (react-markdown 10.1.0) | 23/23 hostile and nesting cases; 0 fetch calls | `results/render-results.json` |
| **Mutation sensitivity** | 11/11 deliberate defects caught; the first run found an uncovered object-depth gap, now covered | `results/mutation-results.json` |
| **Schema consistency** (ajv 8.20.0) | 35 asserted fixtures agree; 10 scan-stage differences recorded; 1 intended normalization difference | `results/schema-results.json`, `schema-divergence.json` |
| **CSP probe** | Zod `Function` constructor calls: 9 by default, 0 with `jitless` | `results/csp-*.log.txt` |
| **Capability simulation** (Node, not WebKit) | validator works without Safari 15.4 APIs; renderer needs `Object.hasOwn` | `results/legacy-webkit-sim.json` |
| **Static scan** (indicative) | 373 files; hits: `structuredClone` (polyfilled), `Object.hasOwn` (needs a shim) | `results/api-scan.json` |
| **Fake-adapter observations** | 13/13 interaction scenarios on an in-memory store. **Not SQLite, not the Tauri plugin, not a native transaction.** | `results/adapter-results.json` |
| **Corrected run** (review R1–R4, Node 22.23.3) | validator 100/100 (50 fixtures, 49 generated, 1 reader check); permanent regressions 29/29; Codex's adapted diagnostics 8/8; renderer 23/23 (unchanged); fake adapter 13/13; 19/19 mutants as expected (16 caught, 3 neutralized; clarified 3 October after the re-review); CSP 0 versus 9 `Function` calls; schema 40 asserted, 0 failed; DTO typecheck positive exit 0, reviewed `Omit` types exit 2 | `results-corrected/` |
| **Before correction** (same new tests on the frozen reviewed prototype) | regressions 7/29 passed (22 failed); Codex's adapted diagnostics 2/8 passed (6 failed), matching the review; corrected fixture expectations 92/100 passed | `results-corrected/before-reviewed-prototype/` |
| **R5 run** (Node 22.23.3) | validator 106/106 (56 fixtures, 49 generated, 1 reader check); permanent regressions 41/41; Codex's adapted diagnostics 8/8; Codex's source-notes diagnostic 6/6; fake adapter 13/13; mutants 22/22 as expected (**19 caught, 3 neutralized**: M10, M12a, M12b); CSP `jitless` 0 calls; schema 56 fixtures, 46 asserted, 0 failed; DTO positive exit 0, negative exit 2 | `results-r5/` |
| **Before R5** (new tests on the frozen R1–R4 prototype) | regressions 37/41 (the 4 orphan-notes tests fail); Codex's source-notes diagnostic 4/6 (the same 2 failures Codex recorded); fixtures 104/106 (59, 60 accepted) | `results-r5/before-r1r4-prototype/` |
| **Proposed persistence tests** | Real SQLite and sql.js tests in the handoff test matrix. **Not run; not implemented.** | handoff §4 |
| **Real database integration** | None. Not in scope. | — |
| **Installed app** | None. | §4.6 |

## 7. Decisions

**Proposed by this contract** (conservative defaults used by the prototype; subject to Codex review and, where they affect product behavior, owner approval):

- one format, JSON, version gate first
- strict unknown-field rejection
- `null` never accepted
- an ID-based answer key, never an index
- reject instead of repair
- code-point limits after NFC
- the custom bounded scanner
- `sourcePage` always null for imports
- no network or execution
- Markdown only for the summary and section bodies of imported guides
- links shown as text; images never loaded

**Proposals awaiting owner or product approval** (none is approved; each conservative default is used only so the package is complete):

| ID | Decision | Proposed default |
| --- | --- | --- |
| D1 | Where the import entry point lives | Study Library toolbar action "Import study packet…" |
| D2 | Replace an existing material's guide/test | **Not offered** in the first slices. Create-new only. Revisit after M2 versions exist. |
| D3 | Provenance without a migration (`provider: "import"`) | Proposed tradeoff: use it and disclose that older binaries show restored imported content as Gemini-labelled; the alternative is to wait for M2. **Owner decision required before Slice B.** |
| D4 | Keep the original packet file as a managed document | No; store only the validated content |
| D5 | Persist `sourceRefs` | No, in the first slice; shown in the preview as unverified. M2 or later. |
| D6 | Persist export IDs | No; M2 mints identity |
| D7 | Idempotency evidence | Compare stored JSON with the payload in the native transaction; no new column |
| D8 | Warn on re-importing an identical packet | Optional later; not in the first slice |
| D9 | Render Gemini guides with Markdown too | No; imported guides only |
| D10 | GFM tables (`remark-gfm`) | Not included; separate review |
| D11 | Open http(s) links externally | No; text only. It would need an opener capability change. |
| D12 | Proposed limits (§2.2, §2.11; render depth 64) | As listed; revise with real exported packets |

## 8. Review correction map (R1–R4)

[Codex's review](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/STRUCTURED_STUDY_IMPORT_REVIEW_2026-10-03.md) found four issues; all are corrected here and [independently closed](STRUCTURED_STUDY_IMPORT_ACCEPTANCE_2026-10-03.md). The permanent tests are in `evidence/…/prototype-corrected/run-regressions.mjs.txt`, with results in `results-corrected/regressions.json`. Before and after counts are in §6.

| Finding | Fix | Permanent tests (exact names) |
| --- | --- | --- |
| **R1 (P1):** identifier-shaped keys and duplicate IDs echoed in diagnostics | Contract-owned path names only, with `<field>` redaction; no field name for unknown fields; duplicates by `index`/`firstIndex`; no packet version value; one allowlisting boundary for every error; `internal_error` for exceptions (§2.12) | `R1: unknown ASCII private keys are redacted at top level and nested`; `R1: credential-shaped unknown keys are redacted`; `R1: nested scan failures under unknown keys use redacted paths`; `R1: duplicate unknown keys are reported without their name`; `R1: duplicate contract-owned key reports only the fixed field name`; `R1: duplicate question IDs are identified by index and firstIndex only`; `R1: duplicate flashcard IDs are identified by index and firstIndex only`; `R1: duplicate choice IDs are identified by index and firstIndex only`; `R1: credential-shaped duplicate question IDs are not echoed beside the credential error`; `R1: answer keys and duplicate choice text never echo packet values`; `R1: directive and legacy-answer fields keep targeted errors from fixed allowlists`; `R1: benign contract-owned paths are kept exactly`; `R1: failure objects contain only allowlisted properties across stages`; `R1: unexpected internal errors return a fixed code without exception text`. Mutants M12, M12c, M12d (caught) and M10, M12a, M12b (absorbed by the other layer). |
| **R2 (P2):** preview claims and references discarded | `preview.data` keeps normalized source claims, export IDs and per-item references in order; `preview.discardedOnSave` lists what is not saved; every non-empty claim is flagged; persistence stays lossy (§2.13, §3.1). Fixtures 54–58 added, and 01, 02 and 04 gained preview assertions. | `R2: preview retains normalized source claims`; `R2: generator-only source is flagged as an unverified claim`; `R2: createdAt-only source is flagged as an unverified claim`; `R2: note-only source is flagged as an unverified claim`; `R2: absent or empty source is not a claim`; `R2: references stay associated with their items and order`; `R2: preview keeps normalized item content and choice IDs for association`; `R2: preview-only information is absent from persistence output`; `R2: discardedOnSave discloses claims, references and export IDs`; `R2: guide-only, questions-only and cards-only preview data`. Mutants M13, M14, M15. |
| **R3 (P2):** Slice A DTOs not type-correct | Import DTOs omit and redefine `provider`; material is `{ title }` with defaults owned by the Slice B native save; reader/validator boundary specified; original-file SHA-256 separated from the canonical content hash (§2.13, §3.4, §3.5) | `R3: persistence material carries only the packet title`; `R3: canonical persistence JSON ignores key order and preview-only values`; `R3: text entry re-derives the byte limit and refuses an unstripped BOM`; DTO typecheck (`dto-check-run-dto-check.sh.txt`): positive exit 0, negative exit 2 |
| **R4 (P2):** gates contradicted the adoption plan | Preparation, implementation, merge and release gates separated; Slice A waits for the foundation/adoption gates or an explicit documented owner exception; D1–D12 relabelled as proposals; D3 is a proposed tradeoff needing an owner decision (header, §3.6, §7, handoff §1/§6/§7) | Documentation review (no executable test) |
| **Harness:** the aggregate runner could exit 0 after a failed step | `run-all.sh` collects failed steps and exits 1 with `OVERALL FAIL`; self-test with a deliberately wrong expectation: exit 1 | `results-corrected/runner-selftest-summary.txt` |

The Codex controls `Control: trailing LF in a flashcard ID is rejected` and `Control: trailing LF in a choice ID and answer is rejected` are kept and still pass. Codex's eight diagnostics are rerun unchanged except that the two R2 retention checks read the documented `preview.data` location instead of probing several guessed locations (`prototype-corrected/run-codex-diagnostics-adapted.mjs.txt`).

### 8.1 Re-review: R5 and documentation corrections (3 October)

[Codex's re-review](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/STRUCTURED_STUDY_IMPORT_REREVIEW_2026-10-03.md) confirmed R1–R4 resolved and found R5. The permanent tests are in `prototype-r5/run-regressions.mjs.txt`; results are in `results-r5/`.

| Finding | Fix | Permanent tests (exact names) |
| --- | --- | --- |
| **R5 (P2):** guide `sourceNotes` with only questions (or an empty summary and sections) were previewed but silently dropped from the payload | Semantic rule `source_notes_without_study_set` at `$.guide.sourceNotes` (§2.4); notes still never count as a guide; blank notes are absent; accepted notes are saved and included in the canonical content. Schema descriptions updated. Fixtures 59–64 added. | `R5: questions with a sourceNotes-only guide are rejected, not silently dropped`; `R5: questions with empty summary and sections plus sourceNotes are rejected`; `R5: a summary that normalizes to empty does not make notes persistable`; `R5: omitted and empty flashcard and section arrays are treated alike`; `R5: credential-shaped or private notes are rejected without echo`; `R5: cards with guide sourceNotes preserve the notes`; `R5: a substantive guide with sourceNotes preserves them (summary or sections)`; `R5: combined guide, cards and questions preserve the notes`; `R5: questions with blank sourceNotes remain valid`; `R5: standalone sourceNotes remain an empty packet`; `R5: sourceNotes normalization is preserved into preview and payload`; `R5: canonical persistence content includes saved sourceNotes and changes with them`. Codex's diagnostic is rerun unchanged except for its output path (`prototype-r5/run-codex-source-notes-adapted.mjs.txt`). Mutants M16 (guard removed), M17 (notes dropped from the payload) and M18 (notes counted as a guide) are all caught. |
| **Mutation counts** | The R1–R4 run was 19/19 as expected: **16 caught, 3 neutralized** (M10, M12a, M12b). An earlier summary said 15 and 4; the recorded JSON was right. With R5: **22/22: 19 caught, 3 neutralized.** | `results-corrected/mutation-results.json` (unchanged); `results-r5/mutation-results.json` |
| **CI wording** | The required check is the single Ubuntu job `Tests, types, and the data-safety guards` (`.github/workflows/checks.yml`). Mac and Windows packaging (`build-desktop.yml`, manual dispatch) and installed testing are separate evidence. Handoff §6 corrected. | Documentation only |
