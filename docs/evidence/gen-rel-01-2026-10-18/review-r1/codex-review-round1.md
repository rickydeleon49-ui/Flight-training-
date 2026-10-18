Independent review round 1 — GEN-REL-01, 18 October 2026

Not accepted. Five blocking findings remain. These are source-derived reproductions; no tests were run or files written under the read-only override.

Identity and evidence

- Worktree: `/Users/rickymac/code/Flight-training-gen-rel-01`
- Branch: `claude/gen-rel-01`
- HEAD: `45b4e2a09c0cd0ec3751ea689abea0f0855c2c60`
- All changes remain unstaged; the index is empty.
- All 12 entries in `source-hashes.txt` match.
- All 21 entries in the evidence `SHA256SUMS` verify.
- The base fast-forward changes only the documented planning, tracker and manifest paths.

Findings

1. **GENREL01-R1 — blocking: epoch protection does not cover cached reuse or consumption of resolved results.**

   **Locations:** [gemini_files.rs:650](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:650), [gemini_files.rs:765](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:765), [gemini_files.rs:836](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:836).

   Cached lookup returns success without checking whether its epoch ended during the await. Waiters likewise consume a resolved `Prepared` without checking the current epoch.

   **Reproduction:** Prepare a cached file; hold its successful lookup response; invalidate the cache and retire the file; release the response. `prepare()` returns the retired reference successfully. Separately, resolve a fresh flight, invalidate before a waiter is next polled, then poll that waiter: it receives the old successful result.

   An old operation can also reach `prepare_fresh()` after invalidation and capture the new epoch, because the operation’s original epoch is not carried through preparation.

   **Required fix:** Bind the operation to its starting context and validate that context across cached lookup, fresh preparation, waiter consumption and subsequent generation/re-preparation. Add controlled regressions for these interleavings. Existing late-finalize tests cover only invalidation before publication.

2. **GENREL01-R2 — blocking: cleanup can delete references still owned by callers.**

   **Locations:** [gemini_files.rs:700](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:700), [gemini_files.rs:804](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:804).

   Returned and shared references have no active-use ownership. Content replacement and LRU eviction immediately retire their files.

   **Reproduction:** Resolve preparation A with a coalesced waiter, but delay the waiter’s consumption. Prepare changed bytes at A’s stored path; `take_candidate()` removes and deletes A. Resume the waiter: it receives the now-deleted reference. LRU eviction can produce the same outcome while a generation still uses an older entry.

   **Required fix:** Track active reference ownership and defer ordinary replacement/eviction deletion until users release it. Context invalidation must instead make obsolete users fail, consistently with R1. Add waiter-versus-replacement and generation-versus-eviction regressions.

3. **GENREL01-R3 — blocking: same-key preparation has a duplicate-upload race.**

   **Locations:** [gemini_files.rs:650](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:650), [gemini_files.rs:743](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:743).

   Candidate selection and flight registration are separate critical sections. `prepare_fresh()` checks only `flights`, although another caller may have published a ready entry between those sections.

   **Reproduction:** Caller B observes no candidate, then pauses before flight registration. Caller A uploads, publishes and removes its flight. Resume B: it sees no flight and uploads the same source again, replacing the ready entry. Concurrent callers revalidating a missing cached copy have an equivalent race.

   **Required fix:** Make ready-entry selection and flight ownership atomic, including a ready-entry recheck before starting an upload. Add a controlled interleaving regression asserting exactly one upload and one shared reference.

4. **GENREL01-R4 — blocking: a processing lookup failure becomes a fresh upload.**

   **Location:** [gemini_files.rs:663](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:663).

   The `if let Ok(file)` discards every error from `wait_until_active()`. This includes transport failures, malformed responses and HTTP 5xx lookup failures. Execution then forgets the cached entry and uploads again.

   **Reproduction:** Seed a ready entry; have its next lookup report `PROCESSING`; have the subsequent poll return HTTP 500. The error is swallowed and `prepare_fresh()` sends the complete PDF again.

   **Required fix:** Preserve typed readiness outcomes. Propagate lookup/infrastructure failures without uploading; permit bounded re-preparation only for explicitly classified unusable copies. Add this sequence to the regression suite. The existing lookup-failure test exercises only the initial lookup.

5. **GENREL01-R5 — blocking: automatic redirects bypass provider URL restrictions.**

   **Locations:** [gemini.rs:195](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini.rs:195), [gemini_files.rs:359](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:359).

   The shared client retains reqwest’s default redirect policy. Validating the initial upload-session URL does not restrict redirect destinations.

   **Reproduction:** Return a valid prefixed upload URL, then answer its finalize request with HTTP 307/308 pointing at a second loopback server. The client follows it with the PDF body. Inspection of the installed reqwest 0.12.28 implementation also shows that cross-host redirect sanitization does not remove `x-goog-api-key`.

   **Required fix:** Disable redirects for these requests, or validate every redirect before following it and forwarding credentials/body. Add synthetic redirect tests proving an unauthorized destination receives no request, key or PDF bytes.

Other review results

The PDF generation branches use `file_data` after successful preparation and propagate preparation failures; I found no reachable inline-PDF fallback. Cache identity includes credential hash, endpoint, current-byte SHA-256, MIME and stored scope. No mutex guard spans a network await, and `FlightGuard` releases abandoned-flight waiters.

The normal healthy-copy refusal branch preserves Google’s generation refusal. Poll counts, deletion timeouts, reuse margin and fallback lifetime are finite. The encoded inline arithmetic correctly uses `4 × ceil(bytes / 3)` plus the fixed allowance; PDF size/page checks remain separate.

The interface diff preserves the shared generation lock and request-owned save guards. Chapter choice opens the existing manual splitter without generation; whole-document sending remains available. The new part test verifies child storage and unchanged child-relative page numbers. Existing saved-content handling is preserved.

Google’s documentation supports the start/upload-finalize protocol, PDF `file_data`, resource lookup/deletion, lifecycle states, temporary 48-hour retention and PDF limits. See [Files API](https://ai.google.dev/api/files?hl=en), [generateContent](https://ai.google.dev/api/generate-content), [file input methods](https://ai.google.dev/gemini-api/docs/file-input-methods), and [document processing](https://ai.google.dev/gemini-api/docs/document-processing). No live provider call or owner key was used.

The evidence scan found no matching key prefixes, provider file locators, upload-session identifiers or private absolute paths. Measurements report synthetic transfer counts without provider speed or reliability claims. Pre-fix failures remain separate. The first helper failure explicitly identifies unexpected `flycheck0` build output; its environmental classification is supported by the receipt.

Protected dependency, migration and release-config paths show no implementation diff. The current schema-14 manifest changes bind the edited trackers; historical execution receipts remain unchanged.

Commands and exits

Read-only reviewer checks:

| Command | Exit/result |
|---|---|
| `git status --short`, `git rev-parse HEAD`, `git branch --show-current` | 0; identity confirmed |
| `git diff --cached --name-only` | 0; empty |
| `shasum -a 256 -c docs/evidence/gen-rel-01-2026-10-18/source-hashes.txt` | 0; 12 verified |
| `shasum -a 256 -c SHA256SUMS` in evidence directory | 0; 21 verified |
| `git diff --check` | 0 |
| Protected-path diff inspection | 0; no listed protected changes |

One initial evidence scan used the wrong relative directory after `cd` and exited 2; it was corrected and repeated successfully.

Implementer-recorded gate, inspected but **not independently rerun**:

| Command | Recorded exit/result |
|---|---|
| `npm run typecheck` | 0 |
| `npm test` | 0; 3,648 passed, 6 skipped |
| `npm run build` | 0 |
| `cargo test --locked` | 0; 561 passed, 6 ignored |
| `cargo clippy --locked --all-targets -- -D warnings` | 0 |
| `cargo fmt --check` | 0 |
| `npm run test:cargo-lock` | 0 |
| Schema-14 helper suite | 1 with `flycheck0`; corrected and post-rebind runs 0, 26/26 |
| Migration/dependency preservation check | 0 |
| Gemini measurement tests | 0; 67 passed |
| Diff and untracked whitespace checks | 0 |

No review document was written, no integration action was taken, and GEN-REL-02–05 and scheduler work were not started. Live-provider and installed-Mac behavior remain UNVERIFIED.

VERDICT: RED