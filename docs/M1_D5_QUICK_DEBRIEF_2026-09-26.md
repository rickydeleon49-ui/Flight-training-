# M1 D5 — Quick Debrief Mode in Existing Journal Flow

Date: 26 September 2026
Repository: `H:\Ai Repo clones\Flight-training-`
Branch: `feature/m1-d5-quick-debrief`
Base: `4e2651c95459277c16e3e97654cfe98cb8efd242` (D3–D4 merged through PR #33)

**Status:** Independent review findings resolved and verified. All 52 test files passed (508 tests passed, 2 benchmarks skipped). `npm run build` completed with 0 errors. Awaiting pull-request CI and merge gate.

---

## 1. Scope and Implementation Summary

Roadmap task **M1 D5** adds a fast, focused **Quick debrief** option to the existing training flight journal system:
- **Fast reflection capture:** Immediately after an instructor flight or ground briefing, the pilot can write down reflections while they are fresh without getting bogged down copying detailed flight times, hobbs/tach meters, multiple landing breakdowns, or aircraft tail numbers.
- **Unified editor & round trips:** Quick debrief is built into the existing `JournalForm.tsx` via an interactive mode toggle (`Quick debrief` vs. `Full flight log & debrief`). Pilots can switch freely between modes without losing typed text. A debrief started in quick mode can be saved and reopened later in the full editor to log flight times.
- **Strict preservation of hidden fields & intentional mode switch edits:** When saving edits in quick mode on an existing flight record, all fields not exposed in quick mode are preserved from the existing record. If the pilot switches to full mode during the editing session to intentionally update, change, or clear any numeric, text, or relationship fields (e.g. updating `totalTime` to 2.5, changing `aircraftId`, clearing `mission`, or clearing `goalId`), and then switches back to quick mode, those intentional edits survive and are saved to the database. Untouched hidden fields remain strictly preserved from existing records.
- **Explicit acceptance & ownership of derived records:** Both `addToPlan` and `saveQuestion` start unchecked (`false`). Reflection text alone never creates a separate instructor question or action. When opted in, the review card displays the exact editable text that will be saved; clearing the review field creates nothing (no invisible fallback to reflection text). Recovered drafts from interrupted sessions never silently accept derived records.
- **Explicit ownership over broad linked-record reconciliation:** The form strictly updates or deletes only records demonstrably created by this specific draft attempt (`draft.createdActionId` and `draft.createdQuestionId`). A shared journal ID or absence from a mount-time snapshot is not proof of ownership. Independently created actions and questions linked to the same journal are never overwritten or deleted by ordinary reflection edits. When approval is explicitly withdrawn by unchecking or clearing, only the owned record is removed; if ownership cannot be established, the record is preserved rather than guessed.
- **Complete user-authored next-step text recovery:** User-entered next-action titles, separately edited question review text, and question edit status (`questionEdited`) are saved and recovered alongside the journal draft. Intentional blank edits are preserved across unmount/reopen cycles without snapping back to reflection text. Legacy drafts without next-step fields remain fully compatible, and "Start fresh" consistently clears all recovery state.
- **Duplicate submission prevention:** Button disables during save and shows "Saving…", ignoring rapid repeated clicks.
- **Preserved existing systems:** Daily-plan recommendations, existing journal workflows, backup compatibility, and source records remain 100% intact. No database schema migration is required.

---

## 2. Review Findings and Root-Cause Corrections

Five review findings have been resolved with reproduction and regression tests:

### Earlier Findings (Mode Switches, Explicit Acceptance, Partial-Save Retries)
1. **Preserve Intentional Edits Across Mode Switches:** Merges `startingDraft()` with `draft` so intentional edits made in full mode survive toggling back to quick mode. (Test: `regression 1: preserves intentional edits across mode switches (numeric, text, relationships, clearing)`).
2. **Explicit Acceptance of Derived Records:** `addToPlan` and `saveQuestion` start unchecked (`false`), and review text strictly uses user-approved text without silent reflection fallback. (Test: `regression 2: requires explicit acceptance of derived records and does not create fallbacks or auto-create`).
3. **Safe Partial-Save Retry Reconciliation:** Reconciles retry attempts and handles failure gracefully. (Test: `regression 3: safe reconciliation of partial-save retries when action is unchecked, text changed, or leaving/reopening`).

### Remaining Review Findings: Explicit Ownership and Text Recovery

### Finding 4: Replace Broad Linked-Record Reconciliation with Explicit Ownership
- **Reproduction:** Create a journal entry and open its quick editor. Through the repositories, create an independent action and question linked to that same journal after the editor mounts. Change a reflection and save. Both independently created records were previously deleted.
- **Root Cause:** The code treated linked records absent from `initialActionIdsRef`/`initialQuestionIdsRef` as owned by this save attempt. Recovered drafts also began with empty ownership snapshots. Furthermore, acceptance selected `linkedActions[0]`, risking overwriting independent records.
- **Correction:**
  1. Replaced snapshot-based reconciliation with explicit ownership tracking: `draft.createdActionId` and `draft.createdQuestionId` record the exact IDs created by this draft attempt.
  2. When creating an action or question upon acceptance, only the demonstrably owned record is updated; if no owned record exists, a new record is created. Independent records are never selected, overwritten, or modified.
  3. When an action or question is not accepted, removal is strictly confined to `ownedActionId` / `ownedQuestionId` AND only if approval was deliberately withdrawn (`actionWithdrawn` / `questionWithdrawn`). Reopening the form where controls reset to unchecked never triggers deletion.
  4. Non-owned records linked to the same journal are completely untouched. If ownership cannot be established, records are preserved. Missing or deleted owned records are handled safely.
- **Regression Tests:**
  - `finding 1: same-journal independent records added after editor opens are preserved by reflection edits`
  - `finding 1: explicit acceptance never overwrites an independent linked record, and withdrawal removes only owned partial record`
  - `finding 1: independent records present when partially saved draft is recovered are never overwritten`
  - `finding 1: failure after journal and action writes remains recoverable with no duplicates on retry or reopen`

### Finding 5: Recover All User-Authored Next-Step Text
- **Reproduction:** Open a new quick debrief. Enter reflection text and a next-action title. Enable the question review control and edit its text separately. Unmount and reopen the form. Re-enable question review. Both the action title and edited question text were empty.
- **Root Cause:** Next-action title, reviewed question text, and question edit status were kept only in transient local React state rather than the persistent draft.
- **Correction:**
  1. Extended `DebriefDraft` with `nextActionTitle?: string`, `questionToSave?: string`, and `questionEdited?: boolean`.
  2. Form changes to next-action title and reviewed question text update `draft` directly, allowing `useDraftRecovery` to serialize and restore them across unmounts and reloads.
  3. Preserved distinction between reflection text and separately edited question text: if `questionEdited` is true, changes to reflections do not overwrite the review field (including intentional blank edits).
  4. Maintained explicit acceptance: recovering text does not auto-check `addToPlan` or `saveQuestion`.
  5. Maintained backwards compatibility with legacy drafts: drafts missing next-step fields default safely to empty action title and derive the review text from reflection questions.
  6. Updated `useDraftRecovery`'s `forget()` to skip mirroring the subsequent reset render so clicking "Start fresh" cleanly clears the draft from storage without immediately saving back an empty draft.
- **Regression Tests:**
  - `finding 2: recovers next-action title and exact edited question text on unmount and reopen, preserving intentional blank edits`
  - `finding 2: maintains compatibility with legacy drafts and ensures Start fresh clears all recovery state`

### Save-Safety Findings: Interruption/Recovery Guarantees and Edit Preservation

### Finding 6: Make Save Identity Durable Before Partial Commits
- **Reproduction:** Explicitly approve an action and question. Allow journal and action creation to succeed. Capture localStorage immediately before question insertion. Simulate interruption by reopening with precisely that captured draft, without the later error-handler changes. Reapprove the recovered action and save. SQLite contained two actions instead of one.
- **Root Cause:** Action and question IDs were generated by repositories upon creation and recorded in refs after creation, then persisted to draft storage only when an error was caught. Any interruption prior to error handling left storage without the created IDs.
- **Correction:**
  1. Enabled pre-assigned IDs in `actionRepository.create({ id: targetActionId, ... })` and `questionRepository.create({ id: targetQuestionId, ... })`, and added `get(id)` methods to both repositories.
  2. Pre-assign stable IDs (`targetId`, `targetActionId`, `targetQuestionId`) and persist them to durable draft storage (`writeDraft`) *before* executing any database side effects.
  3. Reopening and retrying after interruption at any commit boundary (after journal write, after action write, after question write) reuses the exact same IDs, turning partial-creation recoveries into idempotent updates.
  4. Explicit draft storage write failure guard: if `writeDraft` fails (e.g. storage quota exceeded or disabled), the save operation halts immediately with an actionable alert without touching the database, preventing unrecoverable partial commits.
- **Regression Tests:**
  - `save safety 1: durable pre-write identity protects against interruption after journal commit, action commit, and question commit without duplicate records`
  - `save safety 1: refuses to begin partial database commits if draft storage write fails`

### Finding 7: Preserve Edits Made While Saving
- **Reproduction:** Enter text in reflection notes. Start saving and defer the database write. Type new text into the still-enabled reflection control. Reject the write. The form reverted to the text before saving.
- **Root Cause:** Failure catch blocks rebuilt an `updatedDraft` snapshot using the stale closure state captured when save was initiated, wiping out user keystrokes entered while the asynchronous write was pending.
- **Correction:**
  1. Implemented accessible disabled controls during the entire save operation: all form controls (text inputs, selects, textareas, checkboxes, confidence buttons, mode tabs, and action buttons) are disabled during save (`disabled={isSaving}` and wrapped in `<fieldset disabled={isSaving} aria-busy={isSaving}>`).
  2. Removed stale closure overwrites: error catch blocks no longer replace active user state with stale closure snapshots.
  3. Added unsaved edits detection (`hasUnsavedEdits`): if deferred writes succeed but newer edits were made while saving was pending, the form remains mounted with newer edits preserved rather than navigating away or discarding them.
- **Regression Tests:**
  - `save safety 2: disables all controls during save and preserves edits made while saving across deferred write failure and success`

---

## 3. Exposed vs. Hidden Fields in Quick Debrief Mode

| Field | Exposed in Quick Debrief? | Handled on Quick Save (New Entry) | Handled on Quick Save (Existing Record) |
| --- | --- | --- | --- |
| `date` | **Yes** | User input / defaults to today or event date | Updated from user input |
| `eventId` | **Yes** | User selection / prefilled from scheduled lesson | Updated from user selection |
| `title` | **Yes** | User input / prefilled from lesson | Updated from user input |
| `wentWell` | **Yes** | User input | Updated from user input |
| `wasDifficult` | **Yes** | User input | Updated from user input |
| `instructorFeedback` | **Yes** | User input | Updated from user input |
| `questionsForNextTime`| **Yes** | User input | Updated from user input |
| `confidence` | **Yes** | 1–5 confidence button picker | Updated from user selection |
| `aircraftType` | No | Prefilled from profile / event | Preserved verbatim (or intentional full-mode edits) |
| `aircraftId` | No | Empty string | Preserved verbatim (or intentional full-mode edits) |
| `departureAirport` | No | Prefilled from profile | Preserved verbatim (or intentional full-mode edits) |
| `arrivalAirport` | No | Prefilled from profile | Preserved verbatim (or intentional full-mode edits) |
| `instructorName` | No | Prefilled from profile / event | Preserved verbatim (or intentional full-mode edits) |
| `totalTime` | No | `null` | Preserved verbatim (or intentional full-mode edits) |
| `dualReceived` | No | `null` | Preserved verbatim (or intentional full-mode edits) |
| `soloTime` | No | `null` | Preserved verbatim (or intentional full-mode edits) |
| `picTime` | No | `null` | Preserved verbatim (or intentional full-mode edits) |
| `crossCountryTime` | No | `null` | Preserved verbatim (or intentional full-mode edits) |
| `nightTime` | No | `null` | Preserved verbatim (or intentional full-mode edits) |
| `actualInstrumentTime` | No | `null` | Preserved verbatim (or intentional full-mode edits) |
| `simulatedInstrumentTime` | No | `null` | Preserved verbatim (or intentional full-mode edits) |
| `dayLandings` | No | `null` | Preserved verbatim (or intentional full-mode edits) |
| `nightLandings` | No | `null` | Preserved verbatim (or intentional full-mode edits) |
| `mission` | No | Empty string | Preserved verbatim (or intentional full-mode edits) |
| `practiced` | No | Empty string | Preserved verbatim (or intentional full-mode edits) |
| `goalId` | No | Prefilled from event | Preserved verbatim (or intentional full-mode edits) |
| `materialIds` | No | Empty array | Preserved verbatim (or intentional full-mode edits) |

---

## 4. Exact Validation Commands and Results

All checks run locally on Windows x64 (implementer validation; subsequently independently reviewed):

```powershell
# 1. Typecheck and production build
npm run build
# Result: tsc --noEmit && vite build completed with 0 errors in 1.73s

# 2. Focused D5 integration and regression test suite
npx vitest run src/pages/FlightJournal/quickDebrief.test.ts
# Result: 1 file passed, 21 tests passed in 11.19s

# 3. Related regression test suites
npx vitest run src/pages/FlightJournal/quickDebrief.test.ts src/state/useDraftRecovery.test.ts src/state/editorSafety.test.ts src/logic/debriefCharacterization.test.ts src/data/repositories/journalRepository.test.ts src/logic/dailyPlan.test.ts
# Result: 6 files passed, 68 tests passed in 14.13s

# 4. Full test suite
npm test
# Result: 52 files passed | 2 skipped (508 tests passed | 2 benchmarks skipped) in 17.78s

# 5. Whitespace and diff verification
git diff --check
# Result: Clean (0 whitespace errors)
```

---

## 5. Scope Boundaries and Limitations

1. **No schema changes:** Uses existing `journal_entries`, `next_actions`, and `questions` tables.
2. **No AI features:** Feedback reflection and question drafting are 100% user-written.
3. **No automatic proficiency claims:** Debriefing an action or rating confidence does not alter official ACS / certificate proficiency.
4. **Mac validation limitation:** Physical Apple Silicon verification has not been performed in this local Windows session; verification is based on cross-platform Vitest and Vite builds.
5. **Validation posture:** Checks described represent implementer validation; subsequently independently reviewed. No installed Mac testing claimed.

---

## 6. Manual Windows and Mac Verification Checklist

- [ ] **Quick Debrief Entry Points:**
  - [ ] Navigate to `/journal`. Verify "Quick debrief" button appears in the page header next to "Log a flight".
  - [ ] If a past lesson is un-debriefed under "Lessons without a debrief", verify "Quick debrief" and "Full log" buttons appear.
  - [ ] Navigate to a completed lesson in Schedule (`/schedule/:id`). Verify "Quick debrief" button appears under "After the lesson".
  - [ ] Open an existing debrief detail page (`/journal/:id`). Verify "Quick debrief" button appears in the header.
- [ ] **Quick Mode Form Interaction:**
  - [ ] Click "Quick debrief". Verify header reads "Quick debrief" and only reflection fields are displayed.
  - [ ] Verify flight time fields (Total time, Dual received, etc.) and aircraft fields are not visible in quick mode.
  - [ ] Click "Full flight log & debrief" filter-chip at top. Verify mode switches smoothly and all flight time inputs appear.
  - [ ] Type reflection notes, toggle back to "Quick debrief". Verify typed reflection notes are preserved.
- [ ] **Deliberate Action & Question Review:**
  - [ ] Enter a next action title. Verify checkbox "Add '[title]' to your Flight Plan" appears.
  - [ ] Enter a question in "Questions for next time". Verify checkbox "Save an instructor question to the Questions list" appears with an editable question field.
  - [ ] Uncheck both checkboxes and save. Verify entry is created without adding action or question.
- [ ] **Hidden Field Preservation:**
  - [ ] Open an existing flight record that has flight times, aircraft, and route details.
  - [ ] Click "Quick debrief" to edit reflection notes only. Save changes.
  - [ ] Reopen in full editor. Verify total time, dual received, aircraft type, tail number, route, and landings remain completely unchanged.
- [ ] **Cancellation:**
  - [ ] Start a new quick debrief, type some notes, and click "Cancel". Verify no record is added to Flight Journal.

Independent review additionally verified reopening from the durable snapshot after question insertion committed: journal, action, and question IDs remained unchanged on retry. This was a temporary review test, not permanent regression coverage. The permanent interruption test covers the journal and action boundaries despite naming all three. No installed Mac testing was performed.
