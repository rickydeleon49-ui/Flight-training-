# P54-05 approved direction and scope review

The owner said: **"claude also created a draft for some recommendation. i say we go with its choice unless you really need to push back"**. This authorizes the recommended direction in PR202, reviewed at827b408, with bounded technical corrections by the senior reviewer. It does not imply approval of unrelated P54-02 production-engine decisions.

**ACCEPT the lesson brief and single-lesson calendar-export scope**, with the calendar correction below. Both remain unimplemented. The original draft is retained in Git at827b408; [the scope document](P54_05_LESSON_BRIEF_CALENDAR_SCOPE_2026-10-17.md) now states the operative choices consistently.

| Decision | Approved direction |
| --- | --- |
| OD-1 | Both parts; lesson brief first, calendar file second, separate reviewable deliveries |
| OD-2 | Follow-up selection stays in the open dialog; no stored preferences or migration |
| OD-3 | Floating local lesson times, with the existing timezone/travel limitation disclosed |
| OD-4 | A displayed one-hour default if the start has no end; correctly carry a generated end across midnight |
| OD-5 | Reviewer correction under the owner's discretion: omit the synthetic minute-derived SEQUENCE; retain stable UID and UTC snapshot stamp without an update promise |
| OD-6 | Represent rescheduled lessons like cancelled ones in the file; identify the new lesson separately and disclose client-specific cancellation behavior |
| OD-7 | Calendar checklist is off by default and explicitly selectable |
| OD-8 | Single-lesson export only; no batch export in this slice |

## Necessary calendar correction

Two significant edits at10:00:10Z and10:00:50Z yield the same proposed minute-based SEQUENCE. It cannot supply the claimed per-edit revision increment. Avoid a new schema counter for this file-only slice. Also omit METHOD:PUBLISH: that scheduling method requires an ORGANIZER, which this scope deliberately excludes. Keep the snapshot/import limitation and do not promise that re-import updates or cancels a client's existing entry. These are reviewer corrections, not claims that the owner explicitly selected these replacement details. [RFC5545 revision semantics](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.7.4), [RFC5546 PUBLISH requirements](https://www.rfc-editor.org/rfc/rfc5546.html#section-3.2.1).

The data mapping was checked against ScheduleEvent, EventFormDialog, lessonPreparation, dates and the schedule repository. No alternative library or timezone migration is needed to honor the approved direction. The brief retains selected follow-ups, named readiness and the draft's privacy exclusions. Titles/types/topics clarify the draft's otherwise conflicting material-metadata wording; notes and paths remain excluded.

Date validity, strictly later explicit end times, default-duration rollover, escaping/CRLF/UTF-8 folding and independent conformance fixtures are implementation acceptance details. Preview/printing/import behavior remains unverified until implemented and observed; this scope approval does not waive installed or release gates. [Review source identities and revision counterexample](evidence/p54-05-scope-review-2026-10-17/README.md).

## Next delivery and prerequisite

PR199's exploratory proof is accepted and merged atc9347fe, with production adoption still open. PR193 export support must be independently accepted and integrated before P54-05 production work; its Codex-authored save correction still needs an independent acceptance record. Navigation integration remains separately assigned. [Model-neutral continuation](P54_05_NEXT_IMPLEMENTER_PROMPT_2026-10-17.md) closes that review prerequisite, then assigns PartA after PR193 reaches main. PartB follows PartA review under the recorded choices; no new owner questionnaire is needed for these same defaults.

No application/dependency/schema changes, launch, profile/key, provider, installer, signing or release operation is part of PR202. The containing current-base commit requires green exact-head CI before merge. History and the primary settings edit are preserved.
