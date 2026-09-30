# Her Flight Deck — independent repository audit and implementation update

Date: 29 September 2026. Reviewer: Codex. Repository: `rickydeleon49-ui/Flight-training-`.

## Decision

**Hold release approval.** The existing verification suite is green, but independent failure-injection and SQLite/UI reproductions found three release blockers and an offline-study defect. Correct the data-safety and compatibility defects before adding features or publishing the current candidate.

This is a source, dependency, and automated integration audit on Windows. It is not an installed Windows or Apple Silicon smoke test. No product fix, migration, version change, commit, push, release publication, or draft-asset replacement was performed during this audit.

## Audited state and scope

- Checkout: `H:\Ai Repo clones\Flight-training-`, branch `main`.
- HEAD: `c241c4a84dcad6539fea90cbaa48e0f15c92d553`. An authenticated, read-only GitHub API check returned the same SHA for remote `main`.
- Pre-existing uncommitted files: `.github/workflows/release.yml`, `docs/MAC_PARITY_CHECKLIST.md`, `scripts/normalize-installer-filenames.mjs`, `src/logic/releaseSafety.test.ts`. These were preserved. This audit adds this document and an entry in `STATUS.md`.
- Reviewed the current status, roadmap, M2 design, Mac tracker, historical audits, recent release commits, repository/driver boundaries, global state refresh, document lifecycle, PDF extraction, Gemini requests and saved content, backup export/activation, migration guards, capabilities, and check/build/release workflows.
- Ran all existing frontend tests, production frontend build, Rust formatting/lint/tests, lockfile/version checks, npm advisory scan, and RustSec scan. Focused reproductions used synthetic data only.
- Historical workflow evidence and the recorded private DMG checksum were inspected in the repository. The DMG itself was not downloaded, installed, or executed in this audit.

Product sources under `src-tauri/src`, `src/data`, `src/pages`, and `src/components` have no changes between the frozen candidate source `41464607ff85d0a4cf0b837c19b400d8392dfec4` and audited HEAD. The findings below therefore also apply to that candidate's source. Do not treat a Windows reproduction as proof of a Mac runtime outcome; the source-level release risks still need correction.

## Findings ordered by priority

### A1 — P1: a failed restore rollback deletes the recovery database

Location: `src-tauri/src/backup.rs:1969–1983` and `2010–2036`; startup handling in `src-tauri/src/lib.rs:108`.

Both restore error paths ignore errors when moving protected files back, then remove the rollback directory. The install-failure path reports that the previous data was recovered without verifying that recovery succeeded. Startup logs the restore failure and continues setup.

**Reproduced:** stage a valid synthetic complete backup, replace the active data with newer synthetic data, and inject an install failure after protection while creating a directory at the active database filename. Returning the protected database to that occupied path fails. The implementation then removes its protected copy. The independent preservation assertion fails:

```text
error=Restore failed and the previous data was recovered: injected install failure and rollback destination obstruction
active_database_exists=false
recovery_database_retained=false
```

The directory obstruction deliberately exercises an actual filesystem-error path; it is not a claim that normal successful restores lose data. File locks, permissions, and unexpected destination state also need platform-specific coverage.

**Required correction:** inspect every recovery operation; retain the recovery directory and its valid files until recovery is verified; aggregate the original and recovery errors; never claim success when recovery fails. Refuse normal database initialization/migration while restore activation leaves an ambiguous dataset. Review interruption/restart recovery as well: there is no tested durable activation journal covering a process exit between protection and installation.

**Acceptance tests:** successful restore; ordinary install failure; partially completed protection; database/WAL/document return failure; destination obstruction without overwriting its contents; retained recovery-copy hashes; retry/restart behavior; database-only safety restore; complete v1/v2/v3 restores; no silent new empty database after failed recovery. Any crash-recovery mechanism must preserve the exact protected dataset and use a narrowly validated journal.

### A2 — P1: ordinary material/tag saves are not atomic

Location: `src/data/repositories/documentRepository.ts:152`, `171`, `196`, `298`, `363`; file ownership and cleanup in `src/pages/StudyLibrary/MaterialFormDialog.tsx:135–207`.

Ordinary `create` inserts a material before inserting its tags. Ordinary `update` writes the new metadata/file path before replacing tags. Neither operation owns a transaction. Tag resolution trims names but does not deduplicate them; `FAA, FAA` produces the same tag ID twice and violates the material/tag primary key.

**Reproduced against real SQLite with current migrations:**

```text
create -> UNIQUE constraint failed: material_tags.material_id, material_tags.tag_id
row remains: id=audit-duplicate, title=Synthetic FAA, file_path=audit-new.pdf

update -> same constraint failure
row now contains: title=Replacement, file_path=replacement.pdf
```

The form reports a failed save and keeps the newly imported file in its owned/unsaved set. Cancel calls cleanup on that file. Native `delete_document` stages and purges it without checking whether the partially saved row references it. Thus the partial commit can lead to a missing attachment. The SQLite partial commits were executed during this audit; the complete native Cancel flow is a traced consequence, not an installed-app reproduction.

**Required correction:** normalize/deduplicate tags consistently and make each material plus its tags one transaction. Desktop writes must own a single connection; separate pooled Tauri `BEGIN`/`execute`/`COMMIT` calls are insufficient. Reuse or carefully extend the existing pinned native transaction pattern, with equivalent browser/test behavior. Deduplication alone does not fix arbitrary tag-write failures. Ensure file ownership transfers only after a verified durable save and cancellation cannot remove a committed attachment.

**Acceptance tests:** duplicate/whitespace tags; fresh creation; replacement; injected tag failure after metadata write; failed save then Cancel/retry; old/new file hashes and references after each outcome; preserved prior tags on failed update; bounded lock contention; concurrent autosave; driver contract parity; existing automatic/manual split persistence regressions. No migration is needed merely to fix this write boundary.

### A3 — P1: the declared macOS 12.0 minimum exceeds the tested browser compatibility

Locations: `src-tauri/tauri.conf.json:43`, `src/data/repositories/toolkitRepository.ts:13,17`, `src/logic/toolkit.ts:47`, `src/components/ui/Dialog.tsx:41`, `src/components/quickfind/QuickFind.tsx:68`, `vite.config.ts`.

Fresh/invalid toolkit state calls `structuredClone` without a fallback; `loadAll` awaits that repository during startup. Both modal implementations call native `showModal` without an availability guard. WebKit's Safari 15.4 announcement documents these additions and associates that release with Monterey 12.3. The bundle promises 12.0, and the ES2022 build target does not polyfill these browser APIs. [WebKit primary source](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/).

**Reproduced browser-capability simulation:** remove `structuredClone` from the test runtime and load a fresh toolkit; the current repository rejects with `structuredClone is not a function`. Modal incompatibility is confirmed by the unguarded calls and the platform support documentation; an early macOS 12 device was not tested. Existing UI tests install `showModal` mocks and run on modern Node, so their green result does not establish old-WebKit compatibility.

**Required correction:** preserve the requested macOS 12 support through narrow, tested compatibility helpers, or obtain an explicit product decision to change the supported minimum. Do not silently raise the minimum or merely change the transpilation target. Review `newId`'s `crypto.randomUUID` assumption separately against the oldest supported WebKit; use a cryptographically secure fallback if needed, never `Math.random` identifiers.

**Acceptance tests:** fresh install and corrupt/empty toolkit with `structuredClone` unavailable; independently cloned defaults; Dialog and QuickFind with native modal APIs unavailable; keyboard focus, Escape, backdrop, dismissal guards, and focus return; secure ID generation with the modern UUID API absent. Installed tests are required on the oldest supported WebKit as well as the available Apple Silicon Mac. A latest-macOS smoke pass alone cannot close 12.0 compatibility.

### A4 — P2: saved local guides and tests are hidden after disconnecting Gemini

Location: `src/pages/StudyLibrary/MaterialDetail.tsx:657–718` and `805`.

The guide rendering chooses connection/eligibility branches before rendering `studySet`. The practice panel requires `gemini.configured`, an eligible source file, and a ready file. Disconnecting Gemini therefore makes already saved content inaccessible in the interface even though it remains in SQLite.

**Reproduced:** render MaterialDetail with a real synthetic SQLite study set and practice test, an existing eligible PDF, and Gemini status `configured: false`. Independent assertions for the stored guide body and stored practice question both fail: neither is visible.

**Required correction:** gate submission/regeneration separately from display of saved content. Reading guides, revealing cards, and taking saved practice tests must work without a connected key or network. Clearly explain a missing/changed source without hiding stored study content. Preserve explicit submission, generation mutual exclusion, and stale-result ownership protections.

**Acceptance tests:** disconnected key; pending/error status; offline saved guide/cards/test; missing PDF; replaced unsupported/oversized source; no submission/network calls during reading; failed regeneration retains old content; cross-material generation-lock and late-completion tests. Attempt persistence remains a separate M2 feature, not part of this correction.

### A5 — P2: the Mac fixture and verification kit can produce misleading evidence

Location: uncommitted `docs/MAC_PARITY_CHECKLIST.md:180–194`, `213`, `224`, `260`.

- Fixture C uses constant-value image bytes. Its 54,021,830-byte input exceeds 50 MiB, but extraction compresses output streams. A probe of one fixture-style 900,000-byte image compressed to 896 bytes. Input size alone does not prove that this fixture exercises multiple byte-limited output parts. This was a compression probe, not a full-PDF split measurement.
- The generator reuses and mutates `imgBuf` after pushing it into `chunks`. Those queued references ultimately contain the final fill value, so all image streams have the same pixels. The previously checked deterministic hashes can still be correct; they do not establish representative image content or page distinguishability.
- Every text page has the same content, weakening manual verification of page ordering. Add visible page IDs or a separately validated page-content mapping.
- Statements about bounded/stable memory are too strong: `lopdf` still parses the entire source, and extraction clones object graphs. The output window bounds candidate page ranges, not total RSS independently of source size. Measure peak RSS rather than requiring an unsupported memory guarantee.
- The credential command combines `unzip | grep` with `&& ... || PASS`; a read/ZIP failure can be reported as PASS. It also allows grep to print matching entry names despite promising pass/fail-only output. Use checked archive listing and quiet matching with distinct found/not-found/error outcomes. The updated caveat correctly says entry-name inspection cannot prove arbitrary database text is secret-free.

**Required correction/tests:** retain the small/long fixtures where useful, add deterministic incompressible/distinguishable image data that truly produces multiple byte-limited parts, verify page coverage/content and independent-reader validity, and update all hashes/page counts/sizes affected by generator changes. Test archive missing/unreadable/malformed cases and secret entry found/absent cases with no secret output. Keep exact-draft testing separate from local build validation. The previous draft/local-install and raw-ZIP-count documentation defects are corrected in the current diff and are not repeated here as open defects.

### A6 — P2: Gemini's reported retry duration omits request time

Location: `src-tauri/src/gemini.rs:779–801`.

`busy_message` describes attempts taking approximately `total_wait_seconds`, but that helper only sums backoff delays without network time, jitter, or the fallback request. The request timeout is 300 seconds per request. The message can therefore imply a short elapsed duration after substantially longer work.

**Required correction:** remove the elapsed-time claim or measure elapsed time truthfully. Preserve bounded attempts and distinct 429, invalid-key, permission, and model-retirement guidance. Cover delayed responses with an injected clock/HTTP seam rather than live paid requests or arbitrary sleeps.

### Documentation maintenance

`AUDIT.md` remains a historical note, despite sections that appear to describe current facts. It names status field `has_api_key`; current `GeminiStatus` uses `configured`. It implies implemented iOS Keychain behavior, while `platform.rs` explicitly labels that work as deferred. Add a dated correction/reference instead of treating old test counts or migration descriptions as present-day evidence. Keep the distinction between transient masked-input React state and a stored key returned by the backend.

## Existing protections verified and retained

| Area | Evidence in this audit | Limit |
| --- | --- | --- |
| SQLite migrations/M1 debrief | Full frontend and Rust suites include checksum/schema guards, v9 upgrade, contract fixtures, idempotency, provenance, and backup round trips | No installed upgrade was performed |
| Complete backup export | Native tests cover online WAL snapshot, transient/permanent contention, mutation/deletion races, existing destination preservation, integrity, malformed archives, and omission warnings | Export protections do not fix A1 activation rollback |
| Backup compatibility | Native v1, v2, and v3 tests passed; current writer is v3 with two-way document completeness | Do not revert to v2 or weaken SHA-256/path/size/ratio checks |
| Managed-file lifecycle | App-owned relative paths, collision-safe imports, recoverable deletion, corrupt/missing database recovery safeguards, and repair tests | Ordinary material/tag save boundary remains defective |
| PDF extraction | Background work, original read-only source, actual byte/page limits, range validation, partial cleanup, illustrated output equivalence, and pinned part-record transactions pass existing tests | No actual Mac split or native UI responsiveness measured; ignored benchmarks were not rerun |
| Open/Finder/Explorer | Services resolve app-owned paths and use opener; permissions are confined to the app-config root/documents and a specific AI Studio URL | No installed default viewer, Finder, or Explorer test in this audit |
| Gemini submission | Current code sends only the explicitly selected stored file, key in a request header, Rust-owned persisted secret, and guarded generation; existing status/error/lock tests pass | No paid/live generation or real-key archive scan was performed |
| Model availability | Official model pages list `gemini-3.5-flash` and `gemini-3.5-flash-lite`, PDF/text inputs and structured output support | Project/key access and runtime output quality need live testing |
| Release automation | Filename/checksum CLI tests and fail-closed policy tests pass; actions pinned; Windows held; release finalization not automatically cancelled | CI and draft publication were not triggered |

Model sources checked 29 September: [Google Flash documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash), [Google Flash-Lite documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).

The current iOS boundary is preparation, not a built iOS app. Backup Merge remains unimplemented; do not expose it until conflict, compatibility, and rollback behavior are implemented and independently tested. Legacy keyring migration remains present; removal is a separate supported-upgrade decision, not a release-blocking defect.

## Validation evidence

Host: Windows x64, AMD Ryzen 7 5800X3D, 16 logical processors, 34,282,184,704 bytes physical memory (approximately 32 GiB). Node `24.16.0`, npm `11.13.0`, Rust/Cargo `1.98.1`; normal CI uses Node 22. Installed dependencies were reused. No unrelated dependency updates were made.

| Command | Result |
| --- | --- |
| `npm test -- --configLoader runner` | 59 files passed, 3 skipped; **575 tests passed, 3 skipped**; 19.56 s reported suite duration |
| `npm run build` | TypeScript and Vite passed; Vite reported 1.45 s; entry JS 381.14 kB, 118.55 kB gzip |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Passed |
| `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Passed |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | **158 passed, 5 ignored**, zero failures; native test execution 30.91 s, compilation 24.28 s; binary/doc test targets passed |
| `npm run test:cargo-lock` | Passed, read-only lock synchronization |
| `node scripts/check-release-version.mjs 0.5.3` | Passed version-policy validation; this is not release approval |
| `git diff --check` | Passed before audit-note changes; checked again after notes |
| `npm audit --cache <isolated task cache> --json` | Zero reported vulnerabilities |
| `cargo audit --db <isolated current RustSec DB> -f src-tauri/Cargo.lock --no-yanked --json` | Zero unsuppressed vulnerability findings; existing narrow RSA exception retained; informational warnings below |
| `cargo tree --locked --offline --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin -i rsa` and Windows equivalent | No selected RSA path on either shipped platform |
| Independent restore preservation test | **Expected requirement failed**, proving A1; temporary source restored byte-for-byte |
| Independent real-SQLite material save harness | A2 create/update partial commits reproduced; no private data/files touched |
| Capability simulation | Missing `structuredClone` failure reproduced; actual old Mac not tested |
| Independent disconnected-key UI tests | **Two expected requirements failed**, proving A4; temporary test file restored byte-for-byte |

The negative reproductions are new audit evidence, not unexplained stock-suite failures. They must become permanent passing regressions when fixed. Temporary test insertion/restoration was guarded by `finally` and SHA-256 verification. Restoration hashes: `backup.rs` `da43ef2a8fc187001d04df0a4eb978f5a732cfbfcfe63d9c59cc85e56be3e3fa`; `MaterialDetailGemini.test.ts` `db6a0a80bbca67fef79eb265d8e898d460858b689a0c5e76d03c7d3860595711`.

Reproduction scripts/logs and JSON evidence are preserved locally at `C:\Users\ricky\Documents\Codex\2026-09-06\continue-work-on-my-private-github\outputs\audit-2026-09-29`. They are audit tooling outside the application repository.

RustSec database checked at commit `f23b768236fe2880e4cfa167da662cad8ca79240` (updated 29 September). Retained warnings: `proc-macro-error`, `ttf-parser`, five `unic-*` packages (maintenance), and Linux GTK `glib 0.18.5` (`RUSTSEC-2024-0429`, unsoundness). Zero unsuppressed vulnerabilities does not mean zero warnings or universal safety. RSA's exception was checked against selected target graphs. `--no-yanked` means yanked-package status was not independently assessed in this scan.

Not run: `npm ci` (avoid replacing a shared active dependency tree with no manifest/lock change), clean NSIS/DMG installer build, installer execution/update, live Gemini generation, Mac/WebKit profiling, Xcode/iOS compilation, or crash-by-process-kill native smoke. This repository uses SQLite; no PostgreSQL service, keeper, or container was needed or started. No CI minutes were consumed.

## Performance evidence and next measurements

An isolated in-memory SQLite microbenchmark called the real material `list` implementation five times at each synthetic tier. It included metadata mapping, but no tags, generated content, IPC, disk I/O, React paint, or packaged startup.

| Materials | Five runs, ms | Median, ms |
| --- | --- | --- |
| 100 | 0.62 / 0.48 / 0.38 / 0.37 / 0.37 | 0.38 |
| 1,000 | 3.86 / 3.51 / 2.92 / 3.36 / 3.00 | 3.36 |
| 10,000 | 38.37 / 28.90 / 33.73 / 28.99 / 32.08 | 32.08 |

These are a repository baseline, not a speedup or desktop latency claim. Study Library already limits initial rendering to 100 rows and retains full filter coverage. `AppDataContext` still reloads the complete application dataset after each mutation; generated guide/test JSON is included at startup. The mutation queue prevents overlapping frontend writes, and successful writes remain successful even if refresh fails. Keep those protections while profiling scoped refresh opportunities.

Measure click/keypress-to-paint, startup/navigation, save-to-refresh time, PDF import/split wall time, peak RSS, Gemini local preparation separately from network/model time, and complete export/restore on isolated installed profiles. Use the same fixtures, hardware, release build, repeated runs, and baseline commit for comparisons. Do not claim improvement from inspection, this microbenchmark, or old dated results alone. Reserve virtualization, global state restructuring, and PDF dependency changes for measured bottlenecks.

## Implementation order and exit criteria

1. **Restore safety (A1).** Add failing regressions first, correct recovery retention and startup handling, then add interruption/restart coverage. Do not mix new features or archive-format changes into this patch.
2. **Atomic library saves (A2).** Prove duplicate-tag and injected-write failures, implement pinned atomic create/update plus file-ownership tests, preserve part-save behavior.
3. **macOS minimum compatibility (A3).** Decide and test the API strategy while preserving the published support promise; keep installed-Mac evidence explicitly pending.
4. **Offline saved study (A4).** Separate saved-content visibility from permission to regenerate. No practice-attempt schema change.
5. **Test kit and accurate status (A5/A6/documentation).** Correct fixture assumptions, fail-closed archive inspection, and retry wording. Preserve the intended four pending changes; do not accidentally revert their reviewed documentation corrections.
6. **Run the final local matrix once after corrections**, review for data loss/security/migrations/platform regressions, then hand uncommitted work back to Codex. Codex owns the reviewed commit/push/PR/required-check/merge gate. No speculative push or workflow debugging.
7. **Prepare a newly reviewed candidate through the established release process when authorized.** Do not repoint, overwrite, or publish the existing flawed candidate; make the required candidate retirement/version decision explicitly and record it. Source fixes on main do not repair already-built bytes. Keep published v0.5.1, permanently retired v0.5.2, and the Windows hold intact. Smoke-test exactly the future draft asset whose bytes would be published.

The user's planned external-study-guide workflow should follow these reliability corrections as a separately reviewed slice. PDF/Markdown/text material import already provides a useful route for externally authored guides. A direct saved-guide-to-test action needs explicit source provenance, a version/hash identity check so stale results cannot replace newer content, safe structured-output validation, honest absent page citations, and failed-generation retention. Do not expose backup Merge or implement the wider M2 migration/history/scheduler before the real-user check-in and explicit scope approval.

## Physical Mac checklist still open

- Record chip/RAM/macOS, isolated OS account, exact candidate source, asset filename, run, and SHA-256.
- Verify default Gatekeeper behavior; stop if blocked. Never disable protections or use quarantine bypass commands.
- First launch/fresh storage, populated-data upgrade, oldest supported WebKit coverage, dialogs/search keyboard behavior.
- Import then move/delete original; Open in the default viewer; Finder reveal and Settings folder path agreement.
- Automatic long-PDF and genuinely byte-heavy-PDF splitting, exact coverage, original/output hashes, progress/responsiveness and memory; manual ranges/title/limits and safety copy.
- Save/replacement/cancel/tag failure cases; contention with autosave and backups; no partial committed records or attachment deletion.
- Saved guide/cards/practice with Gemini disconnected/offline; one explicit live generation if the tester authorizes network/key use.
- Complete backup to the chosen Downloads path; inspect exact archive; restore with document hashes and M1 links intact; verify v1/v2 compatibility and current v3 integrity; failure retains a readable recovery copy and truthful status.
- Install/update over a populated isolated dataset; all relevant MAC/PERF-MAC tracker items receive observed evidence, not CI-only completion labels.

The expected Mac access on 2 October is an opportunity to collect this evidence; availability alone does not close the release gate.
