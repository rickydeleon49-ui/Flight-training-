Independent review round 4 — GEN-REL-01, 18 October 2026

Accepted with one non-blocking finding. R1–R11 are fixed for their reported reproductions. No blocking defect was found in the corrected implementation.

This review used source, regression tests and recorded receipts. No files were written, builds/tests run, app launched or provider called.

**Identity and evidence**

- Worktree: `/Users/rickymac/code/Flight-training-gen-rel-01`
- Branch: `claude/gen-rel-01`
- HEAD: `45b4e2a09c0cd0ec3751ea689abea0f0855c2c60`
- Changes remain uncommitted and unstaged; the index is empty.
- All **12 source hashes** match `source-hashes.txt`.
- All **43 evidence entries** verify against `SHA256SUMS`.
- Every Markdown-linked implementation-report artifact exists.
- Current schema-14 manifest sizes and hashes match their files.

**Verification of R1–R11**

| Finding | Status | Reasoning |
|---|---|---|
| R1 — stale cached/shared results | Fixed | Captured epochs are checked in `claim`, cached confirmation, waiter adoption and fresh publication. PDF generation checks its context after cleanup. |
| R2 — deleting references still in use | Fixed | Cached acquisition, publication and waiter adoption establish leases under the cache lock. Ordinary replacement/eviction defers deletion until ownership ends. Waiter adoption rejects a retired, unleased reference. |
| R3 — duplicate-upload race | Fixed | `claim()` atomically selects a ready entry, joins a flight or registers an owner. Missing-copy recovery passes through the same decision. |
| R4 — processing lookup failure causes upload | Fixed | `NotReady::Other` propagates lookup failures and poll exhaustion. Only explicitly unusable results permit bounded replacement. |
| R5 — redirects bypass URL restrictions | Fixed | The application client disables redirects. Synthetic upload and generation regressions exercise that client. |
| R6 — cancellation strands a flight | Fixed | `claim()` constructs `FlightGuard` when registering ownership, before retirement awaits. Dropping it removes the matching flight and resolves waiters. |
| R7 — counted lease lacks cancellation guard | Fixed | Fresh publication constructs the actual `Lease` immediately after acquisition, before eviction cleanup awaits. Cancellation releases ownership. |
| R8 — epoch gaps around cleanup/retries | Fixed for reported boundaries | Fresh upload ownership checks after retirement; fresh completion checks after eviction cleanup; generation checks after final cleanup and before each retry/fallback request. |
| R9 — raw refusal messages expose sensitive values | Fixed | Unclassified refusals use fixed wording with the status only. The regression covers echoed credentials, locators, session IDs, paths and content markers. |
| R10 — lookup 403 triggers re-upload | Fixed | Only 404 maps to `Missing`. Lookup 401/403 returns a sanitized `Other` error. Regressions cover cached reuse, processing polls and post-generation recovery. |
| R11 — overly broad file-name pattern | Fixed | Validation enforces at most 40 lowercase alphanumeric/dash characters, without boundary dashes. Negative contract tests cover the previously accepted forms. |

I found no new deadlock, cache lock held across an await, unmatched ownership increment, double acquisition, or ordinary waiter-versus-deletion race in these corrections.

**GENREL01-R12 — non-blocking: reuse expiry is checked before lookup, but not after it**

Location: [gemini_files.rs:815](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:815), also [gemini_files.rs:996](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:996).

`claim()` checks the stored expiry against the reuse margin. After awaiting confirmation, however, `prepare()` accepts the returned expiry based solely on the epoch check. A slow lookup can consume the remaining margin; a newly reported earlier expiry is likewise accepted. Shared-result adoption checks liveness and epoch without checking expiry.

Source-derived reproduction, **not executed**:

1. Seed a cached copy expiring in 16 minutes.
2. Begin reuse and hold its lookup response.
3. Advance the fake clock by two minutes.
4. Release an `ACTIVE` response with the same expiry.
5. `prepare()` returns the copy although it is now inside the configured 15-minute reuse margin.

Required fix: recheck effective expiry against the current clock after confirmation and during shared adoption. Route an unusable result through the existing bounded selection/replacement path. Add a fake-clock regression.

This does **not** require fixing before merge: the normal 48-hour lifecycle and existing missing-copy recovery remain intact. Its practical effect is reduced protection against an expiry-boundary failure, without cross-context reuse or an unbounded retry.

**Remaining acceptance checks**

- **PDF transport:** The reachable PDF branch always prepares a copy and supplies `file_data`. Preparation errors propagate. The `inline_data` branch is reached only for non-PDF sources; no inline-PDF fallback was found.
- **Identity:** The key includes credential SHA-256, endpoint, current-byte content SHA-256, MIME and selected stored path. `LoadedSource::new` hashes the bytes actually read. Cache identity does not retain the raw key.
- **Recovery:** Preparation has two bounded cache-selection attempts. Generation permits one prepared-copy recovery. Lookup infrastructure/access failures do not become uploads. An `ACTIVE` follow-up lookup preserves the generation refusal.
- **Provider references:** Resource URI equality, validated names, upload-prefix validation and disabled redirects prevent arbitrary destination following.
- **Cleanup:** Deletion uses cache-owned names and the creating credential, never lists provider files, has per-request timeouts and ignores deletion failures. Deferred ownership protects ordinary active users.
- **Privacy:** New Files API errors use fixed wording. No new persistence of keys, source bytes, paths or provider locators was found. The evidence pattern scan found no matching credential/session/private-document-path values; this is a source-and-pattern review, not proof about live provider responses.
- **Interface:** Chapter choice closes confirmation and opens the existing manual splitter without sending. Split completion adds no automatic generation. Whole-document sending remains available. Shared locking and request/session save guards remain intact. Child submission/storage and child-relative pages are covered by the regressions. Failure preserves saved content and history.
- **Limits:** Encoded inline arithmetic uses saturating `4 × ceil(bytes / 3)` plus the fixed allowance. PDF size/page checks remain separate.
- **Scope:** Protected migration, checksum, dependency, version and release configuration paths have no implementation diff. The current schema-14 manifest rebinds tracker files; historical execution receipts are unchanged.

Google’s primary documentation supports resumable start followed by upload/finalize, PDF `file_data`, lookup/deletion, lifecycle states and temporary 48-hour retention. PDF limits remain 50 MB/1,000 pages. [Files reference](https://ai.google.dev/api/files), [upload and retention](https://ai.google.dev/gemini-api/docs/files), [generateContent PDF example](https://ai.google.dev/api/generate-content?hl=en), [PDF limits](https://ai.google.dev/gemini-api/docs/generate-content/document-processing).

**Commands and exits**

| Reviewer check | Result |
|---|---|
| Git status, HEAD, branch and index inspection | Git commands succeeded; identity confirmed, index empty |
| Source-hash verification | Exit 0; 12 verified |
| Evidence-hash verification from evidence directory | Exit 0; 43 verified |
| `git diff --check` | Exit 0 |
| Protected-path diff against `2e3f7fe` | Exit 0; empty |
| Read-only report-link and manifest validation | Exit 0; no missing links or mismatches |
| Evidence sensitive-pattern scan | Exit 1; no matches |

Diagnostic command errors: the initial combined identity/memory search exited 1 because the search had no hits. The first evidence-hash check ran from the wrong directory and failed; the corrected check verified all entries. One combined read used evidence-relative working-directory paths incorrectly. A Python heredoc was rejected because the shell attempted a temporary file; it was replaced with `python3 -B -c`, which succeeded. No files were written.

The corrected `review-r3/01…10` receipts were inspected, **not independently rerun**:

| Gate | Recorded result |
|---|---|
| Typecheck, production build | Exit 0 |
| Frontend tests | Exit 0; 3,648 passed, 6 skipped |
| Native tests | Exit 0; 585 passed, 6 ignored |
| Strict Clippy, formatting, Cargo-lock check | Exit 0 |
| Schema-14 helper | Exit 0; 26/26 |
| Diff hygiene and protected-path checks | Exit 0 |

Pre-fix failures remain separate. The initial helper receipt identifies unexpected editor-created `flycheck0` build output, supporting its environmental classification. The R10 pre-fix receipt preserves all three failing regressions. Measurements describe synthetic transfer counts without provider speed or reliability claims.

Live-provider and installed-Mac behavior remain **UNVERIFIED**. No integration action was taken, and GEN-REL-02–05 and scheduler work were not started.

VERDICT: GREEN