# M2 card reviews C1 — independent source review and Xcode verification, 7 October 2026

**Decision: preserve the C1 implementation, but require two focused UI corrections before source acceptance.** C1-R1 and C1-R2 below have four deterministic failed assertions. The frozen diagnostic also has two passing controls and no unhandled errors. The owner-approved C-D1–C-D8 scope remains in force; no repeat approval is needed.

The [active model-neutral correction assignment](M2_CARD_REVIEW_C1_CORRECTIONS_PROMPT_2026-10-07.md) supersedes the initial implementation prompt for remaining C1 work. Review evidence and the executable diagnostic are [published here](evidence/m2-card-review-c1-review-2026-10-07/README.md).

## Submission and preserved work

Reviewed the actual uncommitted source in `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-card-review-c1`, base `73b15976343d2d2a1525e0426dbe6450e6afb850`. All **37 submitted source hashes** and **45 implementation-evidence checksums** match. Migrations 0001–0011 are unchanged. The independent runs used an isolated exact copy; the implementation clone and its pending work were not edited, staged or committed.

The native/browser transaction design, deterministic scheduler, content-addressed identity, generation barrier, reset replay, rollback tests and shared validator fixtures are retained. The additive `Dialog.initialFocus` forwarding and version-9 fixture's migration-12 skip are justified, bounded changes. No production dependency, lockfile, active workflow, capability, version or signing change was submitted.

## Confirmed findings and exact fixes

### C1-R1 — session-start ownership and synchronous exclusion (P2)

**Location:** `src/pages/StudyLibrary/useCardReview.ts`, lifecycle setup at lines 269–281 and `startSession` at 418–446; `CardReviewPanel.tsx` disables Review cards while `starting` is true.

**Trigger:** begin Review cards, hold the queue read, and replace the same material's cards so `contentKey` changes. Setup bumps `scope` but never clears `starting`. The old request's `finally` refuses to publish to the new scope, so `starting` stays true indefinitely even after new cards load. The user cannot begin another review without remounting. A separate same-render double invocation starts two queue reads because React state is not a synchronous exclusion lock; a late second completion can replace an already opened session.

**Evidence:** the frozen `[C1-R1] replacing cards while a session queue read is held releases the current material start lock` expects false and receives true. `[C1-R1] two synchronous starts allocate only one session queue read` expects one call and receives two. Ordinary single-start control passes.

**Fix:** own session-start requests with a synchronous ref/token and a generation. Reset the public start/failure state at every actual scope change. Reject duplicate starts before the first await. Only the current owner may publish a session or release its lock; late success, failure or finally must not modify a newer request. Invalidate obsolete session reads when the session/content context is replaced. Preserve write ownership and retained retry payloads.

**Scope clarification:** MaterialDetail remounts on material-route changes (`key={materialId}`), so the initial unkeyed route probe is not a production navigation finding. The published test uses same-material `contentKey` replacement, which the actual panel supports. Earlier exploratory receipts are preserved and superseded by the frozen diagnostic.

### C1-R2 — history page ownership across reset/refresh and duplicate calls (P2)

**Location:** `src/pages/StudyLibrary/useCardReview.ts`, `loadMoreRecent` lines 525–535; `CardReviewPanel.tsx`, RecentReviews Show more reviews control.

**Trigger:** start a history page read, then reset reviews. The acknowledged reset's refresh replaces history with the authoritative empty page, but the older page still passes the material-only `scope` check and appends erased ratings afterwards. This resurrects erased history **in the UI**; the database remains erased. Two rapid page requests also share a cursor and append the same rows twice, producing duplicate keys/history entries.

**Evidence:** `[C1-R2] a history page held before reset cannot resurrect erased history after the acknowledged refresh` expects zero rows and receives one erased entry. `[C1-R2] two synchronous history requests publish one copy of the next page` expects 21 rows and receives 22. Ordinary single-page control passes.

**Fix:** add a history-list epoch plus synchronous, owner-specific page lock/cursor token. Invalidate pending page publications when reset begins and whenever a fresh first-page refresh or scope/content change replaces the list. A late page or error must not append into the replacement history, reset its cursor, set a stale failure or release a newer lock. Expose loading so Show more reviews cannot request the same page twice; a failed current request must allow retry with the same cursor. ID deduplication may be defensive, but it does not replace epoch invalidation because an erased entry could have a distinct ID.

## Independent verification actually run

| Check | Result |
| --- | --- |
| Submitted identity/evidence | 37/37 source hashes; 45/45 evidence checksums; source unchanged after review runs |
| Focused affected frontend suites | **105 passed**, seven files, exit 0 |
| Frozen independent hook diagnostic | **2 controls passed / 4 defect cases failed**, exit 1; no unhandled errors |
| Native all-target tests using fresh Xcode target | **415 passed / 6 ignored**, exit 0 |
| Tauri debug desktop build, no bundle | exit 0; frontend TypeScript/Vite build and native linking succeed |
| Xcode Clippy, all targets, `-D warnings` | exit 0 |
| Cargo formatting and tracked whitespace | exit 0 |
| Binary metadata | Mach-O arm64; deployment target macOS **12.0**; SDK **27.0** |

Xcode **27.0**, build **27A266a**, selected developer directory `/Applications/Xcode.app/Contents/Developer`; macOS host **27.0.1**, arm64; Node 22.23.3 and Rust/Cargo 1.99.0. Native verification explicitly used Xcode's `MacOSX27.0.sdk` and fresh target `/private/tmp/her-flight-deck-c1-xcode27-review-target`. Exact commands are in the evidence README and raw receipts.

The implementer's final full frontend result (**2,679 passed / 4 skipped**) and earlier SDK-26.5 gate are submitted evidence, not an independently repeated full frontend run. Existing evidence is reused for unchanged areas. The new failures are deterministic hook assertions, not timeouts or Xcode compiler failures.

## Mac verification limits and next step

This establishes native test/build compatibility with the newly installed Xcode toolchain and the binary's declared deployment target. It does **not** establish actual macOS 12 runtime behavior, a launched desktop SQL-plugin/IPC flow, VoiceOver, installed testing, Developer ID signing, notarization or release readiness. No app was launched, installer created, account/profile read or modified, or provider called. The build ran through Tauri/Cargo using Xcode tools; no Xcode IDE project was generated.

Correct only C1-R1/R2 and relevant consequences, then submit for re-review. Reuse unchanged native/Xcode evidence. Application source remains uncommitted and unaccepted until those corrections pass independent review; only this review and its correction prompt are being published.
