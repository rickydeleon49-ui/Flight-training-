# M2 practice-session PR2 review — 5 October 2026

**Not accepted for source integration: four confirmed blocking findings remain.** Preserve the useful UI/history/atomic erasure work and correct the frontend state/identity boundaries together. No PR2 application source has been committed or pushed by Codex.

Reviewed `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-practice-session-ui`, base `61031d4c7143fdf181bba2cc18616c5345521c3e`. All 23 submitted hashes matched; 21 application/test files plus STATUS/handoff are represented. Review inspected actual source/diff and reproduced meaningful failure paths with disposable databases. Temporary diagnostics were removed and every hash reverified unchanged.

## Confirmed findings

### M2UI-R1 — P1: unconfirmed/volatile state is presented as persisted practice

`src/pages/StudyLibrary/PracticeTestPanel.tsx:96` always renders legacy prop questions instead of loaded frozen items. Lines139–140 suppress repository loading errors. `recordAnswer` at line238 updates local selections/responses/feedback before awaiting storage; `handleComplete` at line378 computes a client score, sets completion and calls the callback before the command succeeds. The finished branch at line567 omits mutation/refresh errors and Retry.

Reproductions: a deferred response displays “Correct” and its explanation before any save confirmation; a refused completion shows “Practice test complete” with no Retry while the real attempt remains in_progress; a failed initial read leaves editable volatile questions; a stale cached legacy prop displays old questions after a newer frozen repository version is loaded. Consequence: the user receives a false saved/result signal, and UI question keys can disagree with the item IDs being written. Replace this with repository-authoritative loading/ready/result state. Withhold confirmed feedback/completion and callbacks until durable acknowledgement; retain error/retry visibility in every phase. Do not use standalone test fallback as production storage behavior.

### M2UI-R2 — P1: pending/refresh state does not enforce the approved action boundary

`PracticeTestPanel.tsx:197` casts minimal action receipts to full session state; lines204–215 neither clear missing attempts nor finish failed refresh state. Conflict handling at lines220–223 clears pending state and announces refresh before the best-effort read succeeds. Continue at lines834–838 is not disabled while a mutation outcome is unknown. Retry refresh at lines675–678 calls loadRepositoryState, which never clears refreshError/pendingAction after success. Start/retake/abandon/completion handlers also change displayed state before confirmation.

Reproductions: Continue is enabled during a held response save; after a committed response plus a failed read, successful “Retry refresh” still leaves the error visible and Change answer disabled. Consequence: the user can continue from an unknown outcome or become permanently stuck after recovery. Use one explicit pending action plus an acknowledged-write/read-refresh distinction; exact same-ID retry only for unresolved mutation, read-only retry after acknowledgement, and clear failures/unlock only after authoritative reads succeed. Refresh null/closed/erased attempts correctly. Do not automatically reinterpret receipt snapshots as current editable state.

### M2UI-R3 — P1: history route changes allow an earlier group to replace the new group

`src/pages/StudyLibrary/PracticeHistory.tsx:172` loadAttempts has no cancellation/request-generation guard. A→B navigation reuses HistoryGroupDetailPage; late A results set B’s attempts/title. The confirmation title is derived from those rows, while eraseHistory at lines199–203 targets the current B route key.

Reproduction: defer group A’s read, navigate to B and load its correct title, resolve A; B’s title disappears and A’s rows/title replace it on B’s route. Code then labels an erase confirmation with A while targeting B. Guard list/detail/review requests and actions by route/request identity and reset obsolete state. Ensure displayed group, attempt ownership and destructive target agree.

An additional direct PracticeTestPanel prop-change diagnostic writes a displayed B answer into an existing A attempt when its earlier load resolves late. **Production MaterialDetail keys its page by materialId, providing protection during ordinary material navigation.** This is a supplementary component boundary, not a claim that current keyed production navigation corrupts another material. Keep that protection and make the panel's own identity/async guards coherent while fixing its controller.

### M2UI-R4 — P1: retrying an uncertain erasure creates a fresh destructive action

`PracticeHistory.tsx:194–209` allocates a new UUID on every confirmation and retains only error text. The confirmation footer does not lock duplicate submissions while erasing. The backend correctly replays a same-ID erase, but the UI discards that safety.

Reproduction: first erase commits, another legitimate practice attempt starts, then the first call reports a lost acknowledgement. Clicking Erase history again sends a different ID and deletes that new attempt (remaining count0). The positive control uses the same ID and retains it (count1). Persist the exact pending typed erasure identity/payload in the controller, lock duplicate submits, retry that same action and then refresh. Never create a new erase merely because the earlier outcome is uncertain. Keep source/current-test/backup boundaries truthful.

## Verification and limits

[Evidence pack](evidence/m2-practice-session-pr2-review-2026-10-05/README.md) contains final diagnostics, logs, submitted snapshots/receipts, distinct manifests and restoration proof. Independent frontend: **46 passed (45 existing +1 control), 9 new failures, zero runtime errors**. Eight failed assertions support the four blocking findings; the material prop-change assertion is supplementary. Independent native: **4 erase-history tests passed**. Submitted full gates claim **2,511 frontend passes/4 skips and 390 Rust passes/6 ignored**, plus green type/build/lint/fmt/lock/diff. These remain reported receipts, not independently rerun full gates.

No need to reopen accepted PR1 migration/durability/backup architecture. Current erasure primitives and positive tests are preserved. The submitted report lists several nonexistent native test names and associates the shared validator matrix with the wrong frontend file; correct its map and README’s “independent” wording in a new correction report. Preserve originals. Current migration bytes/checksums were not changed in this submission.

All tests used disposable synthetic storage. No real profile, provider, app launch, physical installed/VoiceOver or release verification was performed. Continue with the [model-neutral correction assignment](M2_PRACTICE_SESSION_PR2_CORRECTIONS_PROMPT_2026-10-05.md); existing approval remains effective.
