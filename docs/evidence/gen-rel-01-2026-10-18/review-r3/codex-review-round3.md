Independent review round 3 — GEN-REL-01, 18 October 2026

Not accepted. R1–R9 are fixed for their reported reproductions, but one additional blocking finding remains. This review used source, tests and existing receipts; no files were written and no builds or tests were run.

**Identity and evidence**

- Worktree: `/Users/rickymac/code/Flight-training-gen-rel-01`
- Branch: `claude/gen-rel-01`
- HEAD: `45b4e2a09c0cd0ec3751ea689abea0f0855c2c60`
- Changes remain uncommitted and unstaged; the index is empty.
- All 12 entries in `source-hashes.txt` match.
- All 31 entries in evidence `SHA256SUMS` verify.
- Every Markdown-linked report artifact exists.
- Current schema-14 manifest file sizes and hashes match.

**Verification of prior findings**

| Finding | Status | Reasoning |
|---|---|---|
| GENREL01-R1 | Fixed | Cached confirmation and waiter adoption enforce the captured epoch. Fresh publication rejects obsolete work. Generation checks after cleanup and before retries address the remaining R8 gaps. |
| GENREL01-R2 | Fixed | Cached acquisition and waiter adoption acquire leases under the cache lock. Replacement and eviction defer deletion until the last lease drops. An unleased, retired shared reference is rejected. |
| GENREL01-R3 | Fixed | `claim()` atomically selects a ready entry, joins a flight or registers ownership. There is no separate candidate-selection/upload-registration window. |
| GENREL01-R4 | Fixed for the reported processing-poll failure | `NotReady::Other` preserves lookup/infrastructure failures and polling exhaustion without uploading. The separate 403 classification problem is R10 below. |
| GENREL01-R5 | Fixed | The application client disables redirects. Synthetic regressions exercise upload and generation redirects using that client. |
| GENREL01-R6 | Fixed | `claim()` constructs `FlightGuard` before returning ownership and before retirement awaits. Cancellation drops the guard, removes the matching flight and resolves waiters. |
| GENREL01-R7 | Fixed | Fresh publication constructs the actual `Lease` immediately after incrementing ownership, inside the critical section. Cancellation during eviction cleanup now releases the count. |
| GENREL01-R8 | Fixed for the reported boundaries | Fresh preparation checks after prior retirement and after eviction cleanup. Generation checks after final cleanup, before each primary attempt and before fallback. |
| GENREL01-R9 | Fixed | Unclassified refusals use fixed wording containing only the status. `compact_error()` is removed; the regression checks echoed locator, credential, session, path and content markers. |

I found no new deadlock, lock held across an await, double acquisition, or waiter-versus-deletion defect in these corrections.

**New findings**

1. **GENREL01-R10 — blocking: a permission-denied lookup triggers re-upload without establishing that the file is missing.**

   **Location:** [gemini_files.rs:427](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:427), propagated through [gemini_files.rs:961](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:961) and [gemini.rs:752](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini.rs:752).

   `lookup()` maps every HTTP 403 to `LookupFailure::Missing`, before inspecting the response. A project/key permission failure therefore becomes proof that the uploaded copy disappeared. Both cached preparation and generation recovery can consequently start another upload.

   This violates the requirement that a lookup failure must not turn into an upload. Google’s guidance treats 403 as a client/access failure, rather than a transient condition that should be retried. [Google troubleshooting guidance](https://ai.google.dev/gemini-api/docs/troubleshooting).

   **Source-derived reproduction, not executed:**

   - Prepare and release a valid cached PDF.
   - Make its next lookup return HTTP 403 with a generic `PERMISSION_DENIED` response; leave upload endpoints successful.
   - Prepare the same source again.
   - `lookup()` returns `Missing`; `confirm()` returns `Unusable`; the second `claim()` removes the entry and starts another full PDF upload.

   The generation variant returns 400/403/404 from generation and then 403 from the follow-up lookup. `run_generation()` announces that the copy was unavailable and re-prepares it despite having established only an access failure.

   **Required fix:** Propagate generic lookup 403 as a fixed, sanitized permission error without uploading. Only a documented, positively classified file-specific condition should justify treating a 403 as missing. Add regressions for cached lookup, processing poll and post-generation lookup asserting no additional upload after generic 403.

2. **GENREL01-R11 — non-blocking: file-name validation is broader than Google’s documented pattern.**

   **Location:** [gemini_files.rs:205](/Users/rickymac/code/Flight-training-gen-rel-01/src-tauri/src/gemini_files.rs:205).

   `valid_name()` accepts IDs up to 64 characters and permits leading or trailing dashes. Google documents at most 40 characters, with neither a leading nor trailing dash. [Google File resource reference](https://ai.google.dev/api/files).

   **Source-derived reproduction, not executed:** `files/-abc`, `files/abc-` and a 41-character lowercase ID pass validation when paired with the matching same-base URI.

   **Required fix:** Enforce the documented length and boundary rules; add negative contract tests. This does not block merge because the existing character restrictions, exact URI equality and disabled redirects still prevent arbitrary-host or traversal requests.

**Other review results**

The reachable PDF generation path prepares a file and supplies `file_data`. Preparation failures propagate; I found no reachable inline-PDF fallback. Text and images retain inline submission. The encoded-size calculation correctly uses saturating `4 × ceil(bytes / 3)` plus the request allowance.

Cache identity includes credential SHA-256, endpoint, current-byte content SHA-256, MIME and selected stored path. The native cache stores metadata only. Cleanup targets named cache-owned resources with the creating credential, never enumerates provider files, and ignores deletion failure.

Google’s REST example supports resumable start, upload/finalize and subsequent PDF `file_data` generation. The resource reference documents lookup, deletion and PROCESSING/ACTIVE/FAILED states. Temporary retention is 48 hours; PDF limits remain 50 MB/1,000 pages. [REST example](https://ai.google.dev/api/generate-content?hl=en), [Files reference](https://ai.google.dev/api/files), [retention](https://ai.google.dev/gemini-api/docs/file-input-methods), [PDF limits](https://ai.google.dev/gemini-api/docs/generate-content/document-processing).

The interface changes preserve the shared generation lock and request/session save guards. Chapter choice opens the existing manual splitter without sending; no generation is added to split completion. Whole-document sending remains available. The child regression verifies child-only submission, child storage and unchanged child-relative page numbers. Failure handling preserves saved content and history. The wording is consistent with the product’s plain-language direction.

Evidence scanning found repository paths and code references in prior review documents, but no apparent real credential, private document payload or upload-session value. Measurements report synthetic transfer counts without provider speed or reliability claims.

Protected migration, checksum, dependency, version and release paths have no implementation diff. The current schema-14 manifest rebinds the three edited trackers; historical execution receipts are unchanged.

**Commands and exits**

| Read-only check | Result |
|---|---|
| `git status --short`, `git rev-parse HEAD`, `git branch --show-current` | Exit 0; identity confirmed |
| `git diff --cached --name-only` | Exit 0; empty |
| `shasum -a 256 -c …/source-hashes.txt` | Exit 0; 12 verified |
| `shasum -a 256 -c SHA256SUMS` in evidence directory | Exit 0; 31 verified |
| `git diff --check` | Exit 0 |
| Protected-path diff inspection | Exit 0; no changes |
| Python read-only report-link and manifest checks | Exit 0; no missing links or mismatches |
| Evidence pattern scan | Exit 0; matches inspected as review/code references |

The initial combined identity/memory-search command exited 1 because the memory search had no matches; its Git identity checks succeeded.

Existing gate receipts were inspected, **not independently rerun**:

| Command / gate | Recorded result |
|---|---|
| `npm run typecheck` | Exit 0 |
| `npm test` | Exit 0; 3,648 passed, 6 skipped |
| `npm run build` | Exit 0 |
| Corrected `cargo test --locked` | Exit 0; 581 passed, 6 ignored |
| Corrected focused Gemini tests | Exit 0; 87 passed, 1 ignored |
| Corrected strict Clippy and fmt | Exit 0 |
| `npm run test:cargo-lock` | Exit 0 |
| Migration/dependency preservation check | Exit 0 |
| Schema-14 helper | Initial exit 1; corrected and post-rebind runs exit 0, 26/26 |

The helper’s initial receipt explicitly reports unexpected `src-tauri/target/flycheck0`, supporting its environmental classification. The round-2 Clippy failure is preserved separately with exit 101; its corrected receipt records exit 0. Reports distinguish earlier frontend receipts from corrected native receipts and acknowledge the absence of frozen pre-correction regression runs.

No integration action was taken. GEN-REL-02–05 and scheduler work were not started. Live-provider and installed-Mac behavior remain UNVERIFIED.

VERDICT: RED