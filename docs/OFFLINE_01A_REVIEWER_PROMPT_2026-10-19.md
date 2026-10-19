# Reviewer prompt: OFFLINE-01a

You are the independent reviewer. Claude implemented this slice. Review the PR diff against main `8d3ebfc`. The governing contract is [the proposal](OFFLINE_01_INVENTORY_AND_PROPOSAL_2026-10-19.md), revision 5, §4–§5. The implementation summary is [the report](OFFLINE_01A_REPORT_2026-10-19.md).

Check, with file:line evidence:

1. **Allocator (`extraction/alloc.rs`):**
   - Accounting for `alloc`, `alloc_zeroed`, `realloc` (grow and shrink, success and failure) and `dealloc`.
   - The compare-and-swap reservation and overflow and underflow handling.
   - Breach signalling: sticky flag, one-shot marker, no allocation on that path, `EINTR` and partial writes.
   - That **app mode stopping counting** can't be triggered by a worker (it is refused once a cap is set) and can't underflow.
   - Whether `dispatch` stops counting at the right time.
   - Any allocation path that bypasses the global allocator in the worker.
2. **Worker (`extraction/worker.rs`, `main.rs`):**
   - Fail-closed dispatch before Tauri starts.
   - The bounded request and `deny_unknown_fields`.
   - Limits that can only be lowered.
   - The cap is set before input is read.
   - The breach check before every frame.
   - Test hooks are unreachable in release builds (`cfg!(debug_assertions)`).
   - The fixed-stack thread.
   - No database, network or WebView use.
3. **Supervisor (`extraction/supervisor.rs`):**
   - Concurrent bounded draining until end of file.
   - The deadline and cancellation kill and reap the child.
   - Frame sequence validation.
   - Classification order: marker, then stop reason, then protocol, then exit.
   - No success without exit 0, end of file and a complete sequence.
4. **Inspection (`extraction/inspect.rs`):** strict decoding, recursive forms, depth and cycle limits, outcome rules. `image_only` and `blank` only from complete inspections. Neutral `unknown` otherwise.
5. **Cache and service (`extraction/cache.rs`, `service.rs`):**
   - Content-addressed correctness across rollback, database-only restore and a late worker.
   - Session-only verification.
   - **Re-hash before deciding in `prepare`.**
   - Disposal of untrustworthy caches.
   - Failures stored only when deterministic.
   - The commands are read-only against the main database and respect `is_root_ready`.
   - Path safety through `safe_relative_path`.
6. **Tests and evidence:**
   - The tests are meaningful, including the object-stream bomb decoded while loading, the fallible-path breach and the stack overflow classification.
   - The pre-fix failing receipt reproduces the `prepare` defect.
   - The measurements and app-mode overhead receipts match the report.
   - Nothing is claimed as a bound or passed that isn't.
7. **Scope:**
   - No dependency, lock, migration, frontend or backup-format change.
   - The trackers and schema-14 manifest verify.
   - Is the stated residual risk acceptable for the 384 MiB cap, and is the app-mode overhead acceptable? Give an explicit accept or reject, as proposal §6 requires before extraction is enabled in a release.

Run if you can, with Node 22 at `/opt/homebrew/opt/node@22/bin` and `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`:

    cargo test --locked --manifest-path src-tauri/Cargo.toml --test extraction_worker --test extraction_service

Report numbered findings with severity (blocking / non-blocking), file:line and the fix. End with exactly one line: `VERDICT: GREEN` or `VERDICT: RED`.
