# GEN-02b implementation — 20 October 2026
Base `5361ff6`, branch `codex/offline-gen`; uncommitted for Claude review. Existing `node_modules` symlink preserved.
Native PDF-reference reuse only; no UI/queue, dependency or SQLite migration. All HTTP fixtures use loopback and synthetic credentials.

Optional `guide-sections-v1.preparedFile`: `name`, `uri`, `allowedHost`, `mime` (strings), `expiresAt` (Unix seconds),
`selectedSha256`, `credentialFingerprint` (SHA256 of the key, which identifies its project), `integrity` (hex HMAC-SHA256).
Ownership tag covers every other field with a secret derivation separate from the stored fingerprint, using existing sha2.
Native leases create descriptors; strict schema, existing gemini_files name/URI/MIME validation and trusted host checks reject edited metadata.
Successful preparation commits/syncs the descriptor before reservation or section dispatch, serialized with context invalidation.
`JobRecord` Serialize/Debug redact the entire preparedFile node; only the private journal writer restores it to disk.
IPC events expose id/stage only; generated answers/exports contain no descriptor. Actual complete-backup ZIP tests exclude the journal.
Exact schema and serialized IPC, Debug/progress logs, exported answer and backup contents are checked; key/session/query secrets never persist.
Existing source identities/provenance keep their source hashes; those are not the native descriptor.

| Resume condition | Lookups / new uploads | Result |
| --- | --- | --- |
| Valid ACTIVE reference | 1 / 0 | Same unfinished request body; skip all finished sections |
| Stored expiry passed | 0 / 1 | Replace within unchanged-source consent |
| Confirmed 404 or provider expiry | 1 / 1 | Replace within unchanged-source consent |
| 401/403 | 1 / 0 | REFERENCE_AUTH_FAILED |
| Transport/service/malformed response or non-ACTIVE | 1 / 0 | REFERENCE_LOOKUP_FAILED |
| Unreadable/tampered metadata, including null/forged ownership | 0 / 0 | DESCRIPTOR_INVALID |
| Changed credential fingerprint | 0 / 0 | KEY_CHANGED; explicit Continue required in later 02c UI |
| Entire guide complete | 0 / 0 | Local assembly/save retry |
Legacy drafts without a descriptor remain readable; preparation runs only on her explicit activation.
Retained ownership survives eviction/disconnect; expiry or committed deliberate discard permits best-effort matching-key deletion.
Shared draft owners and active leases prevent premature deletion. Disconnect/discard cleanup runs in the background and cannot block acknowledgement.
Crash fixtures reconstruct journal/cache before and after descriptor commit: no generation before commit; after commit, reopen reuses with zero uploads.
Before commit, an untracked remote copy may expire naturally and explicit retry can prepare again. These are source fixtures, not installed-app/power-cut claims.

Receipts: `docs/evidence/offline-gen-02b-2026-10-20/`; P/F/I below are summed Rust passed/failed/ignored counts; “no tests” means compile/startup/check only.
- `focused-before.log`: EXIT 101, no tests (missing discard adapter); `focused-1.log`: EXIT 101, no tests (method visibility).
- `baseline-assertions.log`: EXIT 101, 21/10/0; all ten requested contract tests fail against GEN-02a plus old-ack test adapter.
- `focused-2.log`: EXIT 0, 31/0/0; `focused-final.log`: EXIT 0, 35/0/0.
- `edge-before.log`: EXIT 101, no tests (test syntax); `edge-assertions.log`: EXIT 101, 34/1/0 (shared-owner retention, fixed).
- `fingerprint-forgery-before.log`: EXIT 101, 0/1/0; domain-separated authentication fixes public-fingerprint forgery.
- `focused-verified.log`, `focused-secrets.log`: EXIT 0 each, 36/0/0 each; exact upload/lookup counts and section bodies asserted.
- `cargo-test-1.log`: EXIT 0, 933/0/11, default parallel; before final test-only schema/session-secret assertions.
- `cargo-test-2.log`, `cargo-test-3.log`: EXIT 0 each, 933/0/11 each; consecutive final-tree default-parallel gates.
- `format.log`, `format-final.log`, `format-secrets.log`, `fmt.log`, `fmt-final.log`: EXIT 0 each, no tests.
- `clippy.log` (`--locked --all-targets -- -D warnings`), `cargo-lock.log`, `typecheck.log`, `build.log`: EXIT 0 each, no tests.
- `npm-test.log`: EXIT 1, no tests (EPERM writing through existing node_modules symlink).
- `npm-test-runner.log`: EXIT 0; 194 files passed / 4 skipped; 4089 tests passed / 6 skipped. Build uses the same configLoader runner workaround.
- `sandbox-process-observation.log`: EXIT 3 (pgrep/sysmond unavailable), recorded and continued; no socket failures.
- `diff-check.log`: EXIT 0, no tests (final whitespace gate).

SHA256 of changed source files (source list excludes this report; this evidence directory's SHA256SUMS covers report, sources and all receipts):
- `src-tauri/src/fake_gemini.rs`: `693a69c1efdb43810b11f66575b797731fb42f90b1993cdda94e41af3fcb719b`
- `src-tauri/src/gemini.rs`: `3bd66de91885910f4fe5dc4dd3f43b6e3dc98617ede1182a031d756ad50b3bcc`
- `src-tauri/src/gemini_file_descriptor.rs`: `e9fbd84041b45a33df4b52c9b0ae6e5703e24a2c49a9901c75294320eef3f89a`
- `src-tauri/src/gemini_files.rs`: `641f3c068fdacd1045add69c35e5d17a20fc0a51795a2782502d1a25d96dfb6c`
- `src-tauri/src/gemini_jobs.rs`: `c9d21f9aad9b6362591721dbcf3beebc5bc648de4c60a3e62048425b5788139b`
- `src-tauri/src/gemini_sections.rs`: `04565093926d794e8fed22662cc2478a7376a85fc560d44c123ef9b83fd021f7`
- `src-tauri/src/gemini_sections_tests.rs`: `e51c9d415f8b3ecf03388e78fcb8c550b7e17d974622b77934003ac40357c046`
