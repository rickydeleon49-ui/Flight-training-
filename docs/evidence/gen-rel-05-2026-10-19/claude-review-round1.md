# Claude review, round 1: GEN-REL-05 + GENREL04-R12 (uncommitted, base 3d50a64)

I verified independently that the schema-14 helper passes **26/26 outside the sandbox**. Its 25/26 inside your sandbox comes from the process-enumeration denial, not the code, so that is not a finding.

Checked and fine:
- The 20/40/60 targets.
- The request ledger and reservations under the journal lock.
- The per-unit retry loop: it uses the local `attempt`, so later batches keep their retries.
- The shared and persisted deadline.
- Exact duplicate detection.
- Re-hashing the source around each unit.
- Drafts that are never evicted.
- Draft carry-over only when the material, file bytes and revision all match.
- The failed final journal write keeping the draft.
- R12's drop guard.
- The target selector appearing only on the study-aid confirmation.

## Findings

**GENREL05-R1 — blocking — `src-tauri/src/gemini_batches.rs` (`generate`: the unit-0 `validate(&answer, pages, 0)`); schema in `gemini.rs` `study_aid_request`.**
- **Trigger:** the guide-only unit asks for "flashcards must be empty", but the response schema still *requires* a `flashcards` array whose items require front, back and sourcePage. Any real model that returns even one card in the guide response fails `validate(..., max_cards = 0)`. The whole generation then ends with "Gemini's batch was incomplete or too large", which spends retries and leaves only a draft.
- **Required fix:** the guide unit must not fail because it returned cards.
  - Either discard any unit-0 flashcards (preferred: simplest, and no unvalidated cards enter the set),
  - or validate them and treat them as part of batch 1, within its 10-card cap and duplicate rules.
  - Better still, send a guide-only schema without `flashcards` for unit 0, and keep the tolerant handling as defense.
- **Regression:** a synthetic guide response containing cards still completes, the cards are handled as you decide, and the request counts are unchanged.

**GENREL05-R2 — non-blocking (please fix; it's cheap) — `src/services/gemini.ts` `generateStudyAid` adds `requiresAcceptance: true`.**
- **Problem:** the acceptance policy lives in the service wrapper. Every existing page test spies on `generateStudyAid` directly, bypassing the wrapper, so those tests still exercise auto-save for study aids, which never happens in production any more.
- **Fix:** move the policy into `GeminiJobs.tsx` (study-aid answers always wait for acceptance; practice tests keep auto-save). Update any affected tests so they reflect the real flow.

**GENREL05-R3 — non-blocking.**
- **Problem:** the draft deadline uses wall-clock `SystemTime`, so changing the Mac's clock lengthens or shortens a resumed allowance. GEN-REL-03 kept the live budget monotonic.
- **Fix (if cheap):** clamp a resumed allowance to at most what remained when the draft was last written, for example by persisting the remaining seconds alongside the deadline. Otherwise document it as a known limit.

**GENREL05-R4 — non-blocking.**
- **Problem:** the kept-draft notice in `GeminiJobNotice.tsx` is a bare `<p role="status">` written as compressed one-liners, unlike the surrounding notices (`ai-disclaimer`, `stack stack--3` with spacing).
- **Fix:** match the existing notice markup and style.

## Verdict

VERDICT: RED
