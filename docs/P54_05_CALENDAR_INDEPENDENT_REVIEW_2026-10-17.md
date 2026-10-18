# P54-05 calendar export: independent review and completed boundary corrections

**Gemini submission reviewed; Codex boundary corrections implemented, pending independent review. No merge authorized.** Gemini's original commit `ce3c948`, branch and receipts remain preserved. The review branch is `codex/calendar-independent-review-20261017`, based on that exact submission and accepted main `2fc27b9`.

## Submitted identity and review

All8 submitted application/test source hashes and all23 evidence checksums match committed Git blobs. Reviewed the formatter, RFC field projection/escaping, line folding, date/time arithmetic, UI sessions, browser limitation, native chooser metadata/size cap and atomic-writer reuse. Existing source privacy and session guards are retained. The formatter has no runtime dependency, and native calendar files are bounded to64KiB before opening the chooser.

Gemini's raw full-gate evidence is retained:3,629 frontend/6 skips;533 Mac native/6 ignored; build/typecheck, Clippy, fmt, lock and helper checks. These are author receipts, not repeated independent full-suite runs. The submitted final diff was not hygienic despite its report: raw logs have trailing whitespace/blank EOF lines, and three current helper source bindings are stale after tracker edits.

## Findings and completed corrections

| Finding | Trigger / consequence | Correction and proof |
| --- | --- | --- |
| CAL-R1, P2 | Stored event id containing CRLF is interpolated directly into UID; it emits an independent ATTENDEE property. Ordinary generated ids are UUIDs, but the writer must safely encode persisted text as well. | Encode UID with RFC TEXT escaping. A frozen diagnostic fails on ce3c948; permanent regression now prevents the extra property and retains punctuation correctly. |
| CAL-R2, P2 | Date validation trims whitespace while DTSTART formatting uses the untrimmed original. A padded or newline-terminated valid date passes validation and produces malformed calendar syntax. | Require a canonical date before formatting. Both frozen malformed-date diagnostics fail on ce3c948 and pass after correction. |
| CAL-R3, P3 | Invalid/infinite-range DTSTAMP and generated end beyond year9999 produce invalid output. | Refuse invalid/out-of-range stamps and next-day overflow. Three frozen boundary cases fail on ce3c948; additional positive tests retain valid upper-bound dates. |
| CAL-R4, integration hygiene | Final diff check fails on raw receipts; STATUS/ROADMAP/handoff hashes no longer match current helper bindings. | Keep raw bytes unchanged, add exact-path evidence attributes, and refresh only current tracker bindings/manifest checksum. Verify final staged blobs and helper regressions. |

The six frozen counterexamples are preserved with their failed baseline receipt.11 permanent boundary/conformance tests cover those cases plus supported boundaries, escaped UID punctuation and an independently specified complete CRLF/folded ICS fixture. Removed a redundant fold-line branch without changing the75-octet rule. Only `calendarExport.ts` changes application behavior beyond Gemini's submitted implementation; the native writer and UI are unchanged by Codex. Historical author prose naming an `isPendingSave` ref and a PRODID with `1.0` is descriptive drift: actual UI uses the owned `busy` ref, and the exact PRODID is covered by the full golden fixture.

## Independent validation

- Calendar/brief/dialog/event focused suites: **81 passed**, exit0.
- Formatter + boundary suites: **31/31 in each** of UTC, America/Los_Angeles and Pacific/Kiritimati. Frozen diagnostics rerun verbatim: **6/6**, exit0.
- Production web build/typecheck, native export **15/15**, all-target strict Clippy and fmt: **exit0**, with separate raw outputs/exits.
- Final helper **26/26** passes; diff hygiene and Git-blob identity verification are recorded in the evidence README. No repeated full local frontend/native matrix; valid author receipts are reused for unchanged areas.

See [review evidence](evidence/p54-05-calendar-review-2026-10-17/README.md) and [independent reviewer handoff](P54_05_CALENDAR_BOUNDARY_REVIEWER_PROMPT_2026-10-17.md). Current counts/status must be read with the actual receipt exits; no source acceptance authorizes merging this branch.

## Limits and next work

Actual Calendar import/re-import/cancellation behavior, NSSavePanel interaction and installed accessibility remain unverified. No desktop launch, user profile/key, provider call, installer, signing, version change or release. Calendar integration remains pending independent review of Codex's correction and exact-head CI. The separate FSRS evaluation is a planning document requiring factual corrections; it does not authorize a scheduler, migration or retention setting. Existing roadmap priorities and the owner's no-merge instruction remain operative.
