# Structured study-import Slice A: implementation report, 3 October 2026

**Dated Gemini implementation handoff, subsequently independently accepted.** Gemini completed Claude's interrupted source-only Slice A and corrected the report for SA2. Codex closed SA1 and accepted the corrected source/report in the [final acceptance](STRUCTURED_STUDY_IMPORT_SLICE_A_ACCEPTANCE_2026-10-03.md). The branch/base below describe implementation history; the containing source PR supplies required CI and integration evidence. Codex corrected publication citations and archived-report presentation without changing production source.

---

## 1. Resume state, authorization and scope

- **Checkout:** `/Users/rickymac/code/Flight-training-`
- **Branch:** `codex/structured-study-import-slice-a`
- **Base commit:** `696b07021f74104b800bc4a37c9ccb4c437a1abb` (PR #59, accepted contract)
- **Documentation revision:** `0e373cb9ef6865f9b793bb1e71b213a291c03ee1` (`origin/main`)
- **Starting verification:** All 81 submitted files matched the [Codex interruption review starting receipt](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/evidence/structured-study-import-slice-a-resume-2026-10-03/starting-hashes.txt) byte-for-byte; receipt SHA-256 `4fc0cccc759615021d92837d4d6a00dd725c88e6273ec7b5bca6abe00f101d63`.
- **Authorization:** Explicit source-only [owner exception](STRUCTURED_STUDY_IMPORT_SLICE_A_OWNER_EXCEPTION_2026-10-03.md) granted 3 October 2026. Authorizes adding `zod@4.6.5`, pure TypeScript study-packet validator modules, native read-only picker command, desktop-only service wrapper, third-party notice and tests.
- **Strictly out of scope (preserved):** No database writes or replacement flow (Slice B); no import UI screen or toolbar wiring; no provider-label or domain type widening; no Markdown rendering dependency or react-markdown (Slice C); no M2 migrations; no changes to Gemini requests, prompts or API keys; no ordinary-file import changes; no backup/restore changes; no installer builds, signing, notarization or distribution.

---

## 2. SA2 Claim-to-Source Errata Map

The initial Slice A implementation report contained documentation discrepancies against the submitted source and contract. These are corrected as follows:

| Topic | Initial report claim | Verified actual implementation & source anchor |
| :--- | :--- | :--- |
| **Limits & Bounds** | 2 MiB file limit, 64 KiB generic string limit, 10,000 total elements/properties. | `limits.ts:15-20`, `study_packet.rs:19-20`: 4 MiB (4,194,304 bytes) limit in both TypeScript and Rust. Scanner bounds: max depth 8, max 32 keys/object, max 64 code points/key, max 9 integer digits, max 250,000 values. Strings have field-specific normalized code-point limits; there is no generic 64 KiB string or 10,000-value bound. |
| **Directive Fields** | Arbitrary directive fields `action`, `replaceExisting`, `targetDeck`. | `limits.ts:69-78`, `schema.ts:125-131`: Uses exact fixed sets: `DIRECTIVE_FIELDS` (24 names: `actions`, `commands`, `command`, `script`, `scripts`, `exec`, `execute`, `run`, `fetch`, `upload`, `download`, `webhook`, `callback`, `instructions`, `system`, `systemPrompt`, `onImport`, `onLoad`, `html`, `mdx`, `jsx`, `apiKey`, `token`, `credentials`) and `LEGACY_ANSWER_FIELDS` (8 names: `correctIndex`, `answerIndex`, `answer`, `correct`, `correctAnswer`, `correctChoice`, `answers`, `correctChoiceIds`). Other unknown fields are strictly rejected as `unknown_field` without returning the key name. |
| **ID Syntax & Uniqueness** | Lowercase-only regex `^[a-z0-9_-]{1,64}$`, and uniqueness checked across cards and questions combined. | `limits.ts:48-49`, `schema.ts:45-46`, `semantic.ts:59-87`: Item IDs match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$` (1 to 64 chars); choice IDs match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$` (1 to 32 chars). Uppercase letters, dots, underscores, and hyphens are permitted (must start with letter or digit). Uniqueness is scoped separately within flashcards, within questions, and within each question's choices. |
| **Credential Patterns** | Claimed generic JWT detection. | `semantic.ts:11-18`: 6 targeted regex patterns: Google API keys (`AIza...`), provider secret-key style (`sk-...`), GitHub tokens (`gh[pousr]_...`), Slack tokens (`xox[abprs]-...`), PEM private key headers (`-----BEGIN ... PRIVATE KEY-----`), and AWS access key IDs (`AKIA...`). No generic JWT detector exists. |
| **Diagnostics Boundary** | Named `cleanDiagnostics`. | `diagnostics.ts:105-138`: Actual boundary helpers are `publicError(raw)` (applies `PATH_GRAMMAR` redaction and `FIELD_ALLOWLIST`) and `failure(stage, errors)` (enforces `reportedErrors` cap of 50 and computes `omittedErrors`). |
| **Canonical Persistence JSON** | Alphabetically sorted object keys, 2-space indentation, produces content hash. | `payload.ts:111-136`: Produces compact `JSON.stringify` of a fixed-order nested array (`["hfd-study-packet-content/1", [title], studySetArray, practiceTestArray]`). It does not sort keys, indent JSON, or compute a digest itself. The caller hashes the returned UTF-8 string. |
| **R5 Guard Location** | Claimed R5 validation occurs during payload persistence mapping. | `semantic.ts:53-57`, `payload.ts:52`: Rejection of orphan guide notes (`source_notes_without_study_set`) occurs during semantic validation. Payload mapping preserves accepted notes when a study set exists. |
| **Native Picker** | Claimed `rfd::AsyncFileDialog`. | `src-tauri/src/study_packet.rs:91-110`: Uses Tauri dialog plugin extension `app.dialog().file()...blocking_pick_file()` inside `tauri::async_runtime::spawn_blocking`. Dialog waiting and file reading both execute on a blocking worker off the UI thread. |
| **Desktop Wrapper** | Claimed `isDesktop()`, `{ cancelled: true }`, automatic validation, and preview/persistence DTO return. | `src/services/studyPackets.ts:71-82`: Checks `isTauri()`, returns `null` on cancellation or raw picked metadata/text (`PickedStudyPacket`). It does not call the validator or return preview/persistence DTOs; pure validation is a separate caller step. |
| **Finding Identities** | Replaced R3 with fixture byte-drift and R4 with bounded scanning. | Accepted contract identities restored: R1 private diagnostics, R2 preview provenance, R3 import DTO / provider compatibility and reader/hash boundaries, R4 conflicting adoption/integration/release gates, R5 guide source-note loss. Fixture-drift and bounded scanning are additional checks. |
| **Host Environment** | Receipt called system `macOS 26.5.0 Darwin arm64`. | Host is macOS 27.0.1 (Darwin 27.0.0 arm64, Apple M5). `26.5` is the selected compiler SDK version (`MacOSX26.5.sdk`), not the host OS version. |
| **Failure Evidence** | Stated API script proved aggregate failure propagation because it "would exit". | Normal `--self-test` exits 0 after validating mismatch detection. Codex separately executed the runner via CLI with M10 inverted and measured actual process Exit 1. |

---

## 3. Architecture and reference-port preservation

The implementation ports the accepted [contract](STRUCTURED_STUDY_IMPORT_CONTRACT_2026-10-03.md) and reference implementation faithfully:

1. **Strict bounded scanner (`src/logic/studyPacket/scan.ts`):**
   - Implements a manual recursive descent parser without `JSON.parse`.
   - Prohibits prototype poisoning keys (`__proto__`, `constructor`, `prototype`).
   - Rejects duplicate object keys at parse time.
   - Enforces strict contract bounds: max depth 8, max 32 keys per object, max 64 code points per key, max 9 integer digits (fractions and exponents prohibited with `unsupported_number`), max total byte length 4 MiB (4,194,304 bytes), and max 250,000 total JSON values.
   - Prohibits raw control characters and unescaped line breaks.
2. **Schema and normalization (`src/logic/studyPacket/schema.ts`):**
   - Configures `z.config({ jitless: true })` at module top before any schema is constructed.
   - Prohibits `zod/compile` imports.
   - Performs Unicode NFC normalization.
   - Distinguishes single-line fields (spaces collapsed and trimmed) from block fields (LF normalized, trailing whitespace and leading blank lines trimmed, first-line indentation preserved).
   - Counts Unicode code points after normalization (not UTF-16 code units) against field-specific caps:
     - `title`: 200, `sourceGenerator`: 100, `sourceCreatedAt`: 40, `sourceNote`: 1,000, `summary`: 20,000, `heading`: 200, `body`: 20,000, `sourceNotes`: 5,000, `front`: 1,000, `back`: 2,000, `question`: 2,000, `choiceText`: 500, `explanation`: 4,000, `refLabel`: 200.
   - Prohibits unknown fields via strict object schemas.
   - Recognizes fixed `DIRECTIVE_FIELDS` (`directive_field_unsupported`) and `LEGACY_ANSWER_FIELDS` (`ambiguous_answer_key_field`), returning the field name. Other unknown keys return `unknown_field` with no name.
3. **Semantic validation (`src/logic/studyPacket/semantic.ts`):**
   - Validates ID syntax via schema regex: `ID_PATTERN` (`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`) and `CHOICE_ID_PATTERN` (`^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$`).
   - Enforces case-insensitive ID uniqueness separately within flashcards, within questions, and within each question's choices.
   - Enforces unique choice texts within each question.
   - Validates that `correctChoiceId` matches an existing choice ID strictly; case mismatches are rejected (`answer_key_case_mismatch`) and never silently repaired.
   - Detects and rejects credential-like token patterns: Google API keys, sk-style provider secrets, GitHub tokens, Slack tokens, PEM private key headers, and AWS access key IDs.
   - Implements the R5 guard: guide `sourceNotes` that arrive without a substantive study set (flashcards, guide summary or guide sections) are rejected (`source_notes_without_study_set`) and never silently discarded.
4. **Private diagnostics and redaction (`src/logic/studyPacket/diagnostics.ts`):**
   - Enforces the R1 two-layer privacy defense.
   - Layer 1 (upstream): Unknown field names and values are never included in error details.
   - Layer 2 (boundary): `publicError` validates paths against `PATH_GRAMMAR`, redacts non-contract identifier paths to `.<field>`, and allowlists `field` against `FIELD_ALLOWLIST`. `failure` caps errors at `LIMITS.reportedErrors` (50) and reports `omittedErrors`.
5. **Separation of preview and persistence (`src/logic/studyPacket/payload.ts`):**
   - Validated preview DTO retains normalized source claims for UI display.
   - Persistence DTO strips export-only card/question IDs to prevent cross-deck collision.
   - Preserves accepted guide source notes in the persistence payload when a substantive study set exists.
   - `canonicalPersistenceJson` serializes compact JSON of a fixed-order nested array:
     ```text
     ["hfd-study-packet-content/1", [title], studySetArray, practiceTestArray]
     ```
     The caller calculates its SHA-256 content hash over the returned UTF-8 string.

---

## 4. Native reader and desktop service wrapper

1. **Native reader (`src-tauri/src/study_packet.rs`):**
   - Implements `pick_study_packet` Tauri command registered in `src-tauri/src/lib.rs`.
   - Uses Tauri's dialog plugin extension (`app.dialog().file()...blocking_pick_file()`) inside `tauri::async_runtime::spawn_blocking`.
   - Cancellation returns `Ok(None)`, serializing to `null` for the webview.
   - Enforces 4 MiB bounded read (`MAX_PACKET_BYTES = 4 * 1024 * 1024` = 4,194,304 bytes).
   - Uses pre-read metadata size check and streaming bounded reader (`read_bounded`) reading at most `limit + 1` bytes, ensuring files that grow after the metadata check are refused with `file_too_large`.
   - Checks file type before opening; directories, named pipes (FIFOs) and non-regular files are refused without blocking.
   - Computes SHA-256 of original file bytes before BOM stripping.
   - Enforces strict UTF-8 decoding. Strips at most one UTF-8 byte order mark (`0xEF, 0xBB, 0xBF`); a second BOM remains in text for the validator to reject.
   - Returns only base `fileName` (shortened if > 255 chars), never full directory paths.
   - Emits fixed, generic error codes and messages without echoing paths or file contents.
2. **Original-byte vs canonical-content SHA-256:**
   - **Original-byte hash:** Calculated by Rust on exact raw file bytes read from disk (including BOM). Identifies the external file artifact.
   - **Canonical-content hash:** Calculated by caller on the compact fixed-order array JSON returned by `canonicalPersistenceJson`. Identifies the substantive study data.
3. **Desktop service wrapper (`src/services/studyPackets.ts`):**
   - Checks desktop environment via `isTauri()`; throws `DesktopOnlyError` in browser.
   - Returns `null` on dialog cancellation.
   - Returns raw picked packet metadata and text (`PickedStudyPacket` with `fileName`, `byteLength`, `sha256`, `text`, `bomRemoved`).
   - Does NOT invoke validation or return preview/persistence DTOs. Reader and validator remain deliberately decoupled.

---

## 5. Third-party notices and licensing evidence

1. **Dependency provenance and integrity:**
   - Production dependency addition is strictly limited to `zod@4.6.5`.
   - Resolved from `https://registry.npmjs.org/zod/-/zod-4.6.5.tgz`.
   - Lockfile integrity: `sha512-v5l/aFXZQeai4awLbOpSoHecE9UiMrnfx75tEXLjNonXVARxQ5mOeipTjROUchszUNCqnE+hqAMujRsRHsut2Q==`.
2. **JIT-less configuration and Node CSP simulation:**
   - Configured with `z.config({ jitless: true })` before schemas.
   - Prohibits `zod/compile`.
   - Function-constructor counter in `src/logic/studyPacket/jitless.test.ts` confirms 0 calls during validation of all 56 fixtures, with a positive control verifying the counter fires when jitless is disabled.
3. **Notice file and build inclusion:**
   - `public/THIRD_PARTY_NOTICES.txt` contains Zod's MIT copyright and permission notice.
   - Normal build verification proves `dist/THIRD_PARTY_NOTICES.txt` is byte-identical to `public/THIRD_PARTY_NOTICES.txt` (SHA-256: `c497d9ea8d0a8fe60845a208370f698c457b94a0996fe131554955849cd7ba34`).
   - Tauri distribution path: `src-tauri/tauri.conf.json` defines `"frontendDist": "../dist"`. Vite copies `public/` into `dist/` on build, and Tauri embeds `dist/` directly into the bundled application.
4. **Pre-existing gap note:**
   - Earlier production dependencies (e.g. `@tauri-apps/api`, `react`, `react-router-dom`, `sql.js`) are not yet cataloged in `THIRD_PARTY_NOTICES.txt`. This pre-existing gap is preserved as an open roadmap item to prevent out-of-scope license overhauls during Slice A.

---

## 6. Mutation runner repair and failure propagation

1. **Root cause analysis (defect SA1 - closed by Codex):**
   - Claude's scratch runner omitted `package-lock.json` and `public/THIRD_PARTY_NOTICES.txt` when creating scratch test copies.
   - The selected test suite ran `notices.test.ts`, which requires both omitted files.
   - Every single mutant row failed those two notice tests, falsely marking neutralized mutants M10, M12a and M12b as caught.
   - There was no unmodified control run.
2. **Repaired runner (`scripts/run-slice-a-mutations.mjs`):**
   - Scratch-copy function includes all required files: `src`, `package.json`, `package-lock.json`, `public`, `tsconfig.json`, `vite.config.ts`, contract fixture evidence, and symlinked `node_modules`.
   - **Control run:** Executes the scratch copy with zero edits; passes 231/231 tests with 0 failures and exit 0 before any mutation is attempted.
   - **Infrastructure failure distinction:** Differentiates behavioral catches from infrastructure issues (syntax/module load errors, crashes, missing reports, or unrelated notice test failures).
3. **Mutation outcomes (22 mutants):**
   - 19 caught by relevant behavioral assertions (study-packet fixtures, boundary cases, R1/R2/R5 regressions).
   - 3 neutralized by the two-layer defense architecture (M10, M12a, M12b: 0 failures, exit 0).
   - 0 infrastructure errors.
   - 22/22 as expected.
4. **Aggregate failure propagation evidence:**
   - The normal `--self-test` CLI command runs an in-process check verifying mismatch detection and exits 0 when both that check and the 22-mutant suite succeed.
   - Gemini's API-level script (`self-test-failure-propagation.txt`) verified that inverting M10's expectation returned `asExpected: false`.
   - In Codex's independent review (`docs/STRUCTURED_STUDY_IMPORT_SLICE_A_REVIEW_2026-10-03.md`), Codex executed the runner directly via CLI over all 22 rows with M10's expectation inverted from neutralized to caught, measuring an actual process **Exit 1** ([CLI results, log and measured exit receipt](evidence/structured-study-import-slice-a-review-2026-10-03/README.md)).

---

## 7. Local verification matrix outcomes

All checks executed sequentially under scoped PATH `/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH` and `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`:

| Gate | Command | Result | Notes |
| --- | --- | --- | --- |
| Focused frontend | `npm test -- src/logic/studyPacket src/services/studyPackets.test.ts` | Exit 0 | 7 files, 241 passed |
| Focused native | `cargo test --locked --manifest-path src-tauri/Cargo.toml study_packet::tests` | Exit 0 | 16 passed, 256 filtered out |
| Repaired mutation runner | `node scripts/run-slice-a-mutations.mjs --self-test . <out>` | Exit 0 | Control passed (231 tests), self-test passed, 22/22 mutants as expected (19 caught, 3 neutralized) |
| Full frontend | `npm test` | Exit 0 | 74 passed, 3 skipped (77 files); 941 passed, 4 skipped (945 tests) |
| Production build & typecheck | `npm run build` | Exit 0 | `tsc --noEmit && vite build` succeeded, 184 modules |
| Rust formatting | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | Exit 0 | Clean formatting |
| Rust Clippy | `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Exit 0 | Zero warnings (corrected unnecessary literal unwrap in test) |
| Full locked Rust tests | `cargo test --locked --manifest-path src-tauri/Cargo.toml` | Exit 0 | 266 passed; 0 failed; 6 ignored |
| Cargo lockfile sync | `npm run test:cargo-lock` | Exit 0 | Cargo.lock matches Cargo.toml version 0.5.3 |
| Whitespace checks | `git diff --check` and untracked file audit | Exit 0 | No trailing whitespace or CRLF |

**Platform Evidence Boundary Note:**
- Node test simulations, Vitest runs, and native cargo tests verify pure logic and unit boundaries on this Mac host.
- They do not constitute testing on actual WKWebView under real CSP, real native picker UI dialogs, macOS 12.0–12.2 compatibility, Windows native behavior, installed applications, or signed bundles.

---

## 8. Accepted Finding Identities (R1–R5)

The port faithfully preserves the accepted review finding identities established in the contract and handoffs:

- **R1: Private diagnostics.** Upstream error omission and boundary redaction ensure private packet content and unallowlisted keys are never echoed in diagnostic paths or error details.
- **R2: Preview provenance.** Source claims without a generator are marked `source_claim_unverified`. Verified preview retains source claims for user review.
- **R3: Import DTO / provider compatibility and reader/hash boundaries.** Preserves material, studySet, and practiceTest DTO contracts. Strictly separates original-byte SHA-256 (computed by Rust on raw disk bytes) from canonical content SHA-256 (computed on compact fixed-order array JSON).
- **R4: Conflicting adoption, integration and release gates.** Honors foundation gates (A2 published/accepted, M2 real-user check-in), the narrow Slice A owner exception boundary, and release candidate holds.
- **R5: Guide source-note loss.** Rejects guide `sourceNotes` that arrive without a substantive study set (`source_notes_without_study_set`) in semantic validation, preventing silent loss. Preserves notes in the persistence payload when a study set exists.

*(Additional checks: Fixture byte-drift protection and bounded scanner limits are supplementary verification guarantees, not replacements for R3 or R4.)*

---

## 9. Remaining gates

| Gate | Status | Required next action |
| --- | --- | --- |
| Codex independent re-review | Accepted | SA1/SA2 closed; see final acceptance |
| CI exact-head check | Pending | Single Ubuntu CI job on reviewed commit |
| Merge Slice A | Pending | Fast-forward or PR merge into main |
| Foundation gate: A2 published/accepted | Not met | Windows owner publishes and validates atomic material saves |
| Foundation gate: M2 real-user check-in | Not met | Real-user check-in with owner scoped approval |
| Slice B (persistence & replace) | Not started | Requires A2 and M2 gates |
| Slice C (markdown rendering) | Not started | Optional; requires dependency review and macOS 12.0–12.2 checks |
| Packaging & release holds | Unverified | Installed Mac testing, signing, notarization, release holds remain in effect |
