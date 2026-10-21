# FLAKE-CR-01 diagnosis

The original C1-R2 check awaited the reset notice, then checked that the
accessible “Recent reviews” heading was absent. Neither condition proves the
post-reset history read completed:

- The fallback modal hides background elements with `aria-hidden` and `inert`.
  `queryByRole` reports no accessible heading even while its history is present.
- `afterAcknowledged` sets the reset notice before awaiting `refresh`. The
  dialog closes when resetPending clears, while the old first page may still
  be displayed and changes remain locked until the refresh finishes.
- Releasing the held page inside `act` flushes other pending UI work too.
  The heading may become accessible again before the refreshed empty first
  page arrives. That is not proof that the held page resurrected any row.

`CardReviewResetTiming.test.ts` controls three promises independently: the old
page, reset acknowledgement and new first page. It demonstrates that the
original absence check passes with history still present but modal-hidden,
then history is visible again after acknowledgement while refresh is held.
The old page is rejected by the existing history-epoch guard; the refreshed
empty first page clears history and unlocks changes. No sleeps or timeout
increases. See `flake-deterministic-final.log` (the late page has a distinct ID so
deduplication cannot mask a missing epoch guard).

The test correction waits for the reset dialog to close and the reset button
to become enabled (successful authoritative refresh), then asserts history
absence before releasing the obsolete page. Other multi-stream assertions
wait for the specific updated result, rather than another stream's notice.

The first default concurrent attempt failed at startup because Vite could not
write through the existing node_modules symlink. The permitted runner loader
was used thereafter. The first executable pair overlapped addition of the
failing-first kit tests; its only failures were those two expected kit tests.
Do not treat those runs as an immutable clean baseline. Reproduction pairs
3/4 and 5/6 ran without changes to existing frontend source/tests during them.
No card-review/Review-due failure appeared in those three executable pairs.
The historical load failure did not reproduce. The last two pairs instead
failed the existing 1,000-card benchmark time limits (and their completion
accounting). The deterministic modal/refresh evidence still identifies a
specific wrong completion assumption in C1-R2. No product code in the review
controller was changed; no timeouts, retries or skips were added.

## Post-fix concurrency result

All three post-fix concurrent pairs completed with zero card-review or
Review-due failures. The full-suite exits remained 1: benchmark timeouts and
completion accounting in all six runs; pair 2 additionally failed Questions
paging, StudySetEditing and a Flight Path remaining-ui case. Complete names
and counts are recorded in `FAILED_TEST_NAMES.md`, `receipts.json` and the raw
`flake-after-*.log` receipts. No changes were made to those other test files.
The normal sequential runs are recorded separately.
