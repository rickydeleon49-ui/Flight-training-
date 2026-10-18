Independent review round 2 — GEN-REL-01, 18 October 2026

Not accepted. Four blocking findings remain. No files were written and no builds or tests were run, following the read-only override. Reproductions below are derived from source inspection; they are not executed failing tests.

**Identity and evidence**

- Worktree: `/Users/rickymac/code/Flight-training-gen-rel-01`
- Branch: `claude/gen-rel-01`
- HEAD: `45b4e2a09c0cd0ec3751ea689abea0f0855c2c60`
- Changes remain unstaged; the index is empty.
- All 12 source hashes match `source-hashes.txt`.
- All 25 evidence entries verify against `SHA256SUMS`.
- Every Markdown-linked report artifact exists. Current schema-14 manifest bindings match their files.

**Round-1 findings**

| Finding | Status | Reasoning |
|---|---|---|
| GENREL01-R1 | **Not fully fixed** | Original cached-lookup and waiter-consumption reproductions are addressed through epoch checks in `claim`, cached confirmation and `adopt`. Epoch enforcement still has await gaps and does not cover individual generation retries; see R8. |
| GENREL01-R2 | **Fixed for the reported deletion races** | Cached callers acquire leases atomically; replacement and eviction defer deletion while leased. Waiters either acquire a still-live copy or retry selection. The new ownership implementation has a separate cancellation leak; see R7. |
| GENREL01-R3 | **Fixed** | `claim` atomically chooses a ready entry, joins a flight or registers ownership. Concurrent missing-copy revalidation passes through this same decision. |
| GENREL01-R4 | **Fixed** | `NotReady::Other` propagates processing-poll failures and exhaustion without uploading. Explicit unusable outcomes allow the bounded replacement attempt. |
| GENREL01-R5 | **Fixed** | The application client disables redirects. Upload and generation redirect regressions use that client and assert no requests reach the unauthorized destination. |

The added tests cover the original interleavings, but not the cleanup-await and cancellation boundaries below.

**New findings**

1. **GENREL01-R6 — blocking: cancellation before `FlightGuard` construction strands the flight and its waiters.**

   **Location:** [gemini_files.rs:780](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:780), with guard construction at [gemini_files.rs:988](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:988).

   `claim()` inserts a new flight and returns `Claim::Own`, but `prepare()` awaits retirement before entering `prepare_fresh()` and constructing its `FlightGuard`. Dropping the future during that retirement leaves the registered flight without an owner or cancellation guard. Subsequent same-key callers join its unresolved cell indefinitely.

   **Source-derived reproduction:** Prepare and release content A. Request changed content B at the same stored path; hold the DELETE response for A. At this point B’s flight is registered. Start another B preparation, then drop the first B future. The second caller remains waiting, and later B callers join the same abandoned flight. The deletion timeout cannot repair it because its owning future was dropped.

   **Required fix:** Establish RAII flight ownership immediately when registration succeeds, before any await. Dropping that owner must remove the matching flight and resolve its waiters. Add a controlled regression that cancels during retirement before upload begins.

2. **GENREL01-R7 — blocking: fresh publication increments lease ownership before an await without constructing a lease.**

   **Location:** [gemini_files.rs:1029](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:1029), cleanup await at [gemini_files.rs:1064](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:1064).

   Fresh publication calls `inner.acquire(&id)`, resolves the shared result and disables the flight guard. It then awaits eviction cleanup. The corresponding `Lease` is constructed only after that await. Cancellation during cleanup therefore leaves an `in_use` count that no `Lease::drop` can release.

   **Source-derived reproduction:** Fill the ready cache with released entries. Prepare one more source and hold deletion of the evicted entry. Drop the preparation while that DELETE is pending. Its newly published file retains an ownership count of one. Replace or evict that new entry: it enters `deferred` permanently because no caller owns the missing lease. Repeating this sequence accumulates stale ownership and deferred metadata.

   **Required fix:** Construct and retain the actual RAII lease before awaiting cleanup. Every ownership increment must immediately belong to a drop guard. Add cancellation coverage asserting ownership returns to zero and later replacement can retire the file.

3. **GENREL01-R8 — blocking: epoch checks do not cover cleanup awaits or subsequent generation attempts.**

   **Locations:** [gemini.rs:767](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini.rs:767), [gemini.rs:779](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini.rs:779), [gemini.rs:1133](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini.rs:1133), [gemini_files.rs:781](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:781).

   There are deterministic await windows:

   - `run_generation()` snapshots `is_current()` **before** awaiting `finish()`. If invalidation occurs during deferred deletion, it returns the successful result using the old boolean.
   - `generate_on()` checks the epoch once before the entire retry/fallback sequence. Disconnect during a retry pause still permits further requests with the old key and a reference invalidation may already have deleted.
   - A fresh owner can wait for retirement after `claim()`, then begin uploading after its epoch has ended, without rechecking.

   **Source-derived reproductions:**

   - Hold a lease for A; replace A so its deletion is deferred. Complete A’s generation successfully, then hold the DELETE started by `finish()`. Invalidate the cache and release DELETE. `run_generation()` returns success from the ended context.
   - Return 503 from the first generation attempt, invalidate during backoff, then let the pause finish. The retry loop submits another request with the obsolete context.
   - Hold retirement before a new owner begins uploading, invalidate, then release retirement. The obsolete owner still starts its upload.

   **Required fix:** Recheck the captured epoch after cleanup awaits and immediately before each new upload, generation retry and fallback request. Check the epoch after cleanup when deciding whether to publish a successful result. These checks belong to the prepared-source lifecycle; they do not require implementing GEN-REL-03. Add controlled regressions for each boundary.

4. **GENREL01-R9 — blocking: unclassified generation refusals expose raw provider messages containing cloud locators or other sensitive values.**

   **Location:** [gemini.rs:1305](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini.rs:1305), through [gemini.rs:495](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini.rs:495).

   `compact_error()` returns `/error/message` verbatim. The default refusal branch includes it in the returned user-facing error. With the new uploaded-file path, provider messages can contain a file resource name or URI. No redaction or allowlist protects this branch. The privacy test checks successful progress messages, not returned refusal errors.

   **Source-derived reproduction:** Configure the synthetic server to return HTTP 409 with an `error.message` containing a synthetic uploaded-file locator and marker text. Generation returns those values verbatim. The same path accepts echoed key or source-content markers.

   **Required fix:** Use fixed, classified wording for unrecognized generation refusals, or a sanitizer that demonstrably excludes the prohibited values. Add synthetic error-body tests covering returned errors, including file names/URIs, credentials, session identifiers, private paths and source-content markers.

**Other review results**

The reachable PDF branches use `file_data`; preparation failures propagate and do not fall back to inline PDF transmission. The non-PDF branch retains inline text/image behavior. Cache identity includes credential hash, endpoint, current-byte SHA-256, MIME and selected stored path. I found no cache mutex held across a network await.

Poll count, backoff, reuse margin, fallback lifetime and individual deletion timeouts are finite. A confirmed ACTIVE copy preserves the original generation refusal. Cleanup targets named cache-owned files with the creating credential hash and never enumerates provider files.

Google’s documentation supports resumable start followed by upload/finalize, resource lookup/deletion and the PROCESSING/ACTIVE/FAILED lifecycle. The REST reference also demonstrates PDF `file_data`; temporary storage lasts 48 hours, and PDFs retain the 50 MB/1,000-page limits. [Files reference](https://ai.google.dev/api/files?hl=en), [generateContent](https://ai.google.dev/api/generate-content?hl=en), [retention](https://ai.google.dev/gemini-api/docs/files), [PDF limits](https://ai.google.dev/gemini-api/docs/document-processing).

The interface changes preserve the shared generation lock and existing request/session save guards. Chapter choice opens the manual splitter without generation; whole-document sending remains available. The part regression verifies child storage and unchanged child-relative page numbers. Failure handling preserves saved content.

The encoded-size calculation correctly uses `4 × ceil(bytes / 3)` with saturating arithmetic and the fixed request allowance. PDF checks remain separate.

Dependency, migration and release configuration paths show no implementation changes. The schema-14 manifest changes rebind the edited trackers; historical execution receipts remain unchanged.

**Commands and evidence limits**

| Read-only check | Exit/result |
|---|---|
| `git status --short`, `git rev-parse HEAD`, `git branch --show-current` | 0; identity confirmed |
| `git diff --cached --name-only` | 0; empty |
| `shasum -a 256 -c …/source-hashes.txt` | 0; 12 verified |
| `shasum -a 256 -c SHA256SUMS` in evidence directory | 0; 25 verified |
| `git diff --check` | 0 |
| Protected-path diff inspection | 0; no listed protected changes |
| Read-only report-link and schema-14 binding checks | 0; no missing links or mismatches |

An initial Python here-document command exited 1 because the shell attempted a prohibited temporary-file operation. It was replaced with `python3 -c`; the read-only checks then succeeded.

Inspected implementer receipts, **not independently rerun**:

| Gate | Recorded result |
|---|---|
| Typecheck, frontend tests, build | Exit 0; 3,648 tests passed, 6 skipped |
| Corrected full native suite | Exit 0; 574 passed, 6 ignored |
| Corrected focused Gemini suite | Exit 0; 80 passed, 1 ignored |
| Corrected strict Clippy and fmt | Exit 0 |
| Cargo-lock and migration/dependency checks | Exit 0 |
| Schema-14 helper | Initial exit 1; corrected and post-rebind runs exit 0, 26/26 |

Receipts appear to preserve raw output. Pre-fix and environmental failures remain separate. The first helper failure explicitly reports unexpected `flycheck0` build output, supporting its environmental classification. Synthetic measurements make no provider speed or reliability claim. Evidence scanning found review-document paths and code references, but no apparent real credential, private source payload or upload-session value.

The report honestly distinguishes the corrected native receipts from the earlier frontend gate and acknowledges that no frozen pre-correction regression run exists. Live-provider and installed-Mac behavior remain UNVERIFIED.

No integration action was taken. GEN-REL-02–05 and scheduler work were not started.

VERDICT: RED