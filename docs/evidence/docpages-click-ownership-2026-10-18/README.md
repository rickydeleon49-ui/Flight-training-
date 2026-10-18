# DocumentPagesPanel: a click before passive effects was silently refused

## Symptom

`DocumentPagesPanel.test.ts` failed intermittently under full-suite load, in several different tests: CI runs 39156104650 and 39167989787, plus local runs during GEN-REL-02 and GEN-REL-03. In each, `findByText("This PDF has 50 pages.")` never succeeded after a **Check pages** click.

## Cause, found by measurement rather than by raising timeouts

1. **Not slowness.** When the check works, the wait from the click to the page count is 4–10 ms (30 samples under full-suite load). A failure still occurred with the wait raised to 5 s and to 20 s.
2. **Not a disabled button.** All 40 recorded clicks hit an enabled button.
3. **The check never ran.** A trace of a failing run (`trace-of-a-failure-before-fix.txt`) shows the click, then only the panel's initial `read`, and no `inspect` call at all.

The navigation hook's action lease (`useMaterialNavigation`'s `active.current`) and the panel's notice owner (`notices.current`) were both set in **passive** `useEffect`s. React can commit the panel's DOM, and make it clickable, before passive effects run. That gap is wider when the machine is busy. A click in it found no lease, so `refreshAfter` refused it as `STALE_STATE`, and the notice-owner check suppressed the error message. The result was a button that did nothing.

## Fix

Both ownership markers are set in `useLayoutEffect`, during the commit, before any event can reach the new controls. Their cleanup on unmount or context change is unchanged.

## Evidence

- `prefix-regression-failing.log`: the new regression, "an action started before passive effects have run still runs and refreshes" in `useDocumentNavigationLifecycle.test.ts`, fails on origin/main's hook with `refused: This changed somewhere else.…`. It passes with the fix.
- Navigation suites pass, 102/102.
- `full-suite-8-runs-after-fix.txt`: no `DocumentPagesPanel` failure in 8 full frontend runs, versus 3 in about the previous 10. Two other intermittent failures appeared there, and both are outside this fix:
  - `CardReviewPanel.test.ts` "C1-R2 … UI reset while page response is held", which also failed in an earlier session before this change existed;
  - `skillEvidenceValidationParity.test.ts` "sql.js gives the listed outcome", in schema-14 validation code this change does not touch.

  Each needs its own investigation.

No timeout, retry or skip was changed. No product wording changed. Synthetic data only.
