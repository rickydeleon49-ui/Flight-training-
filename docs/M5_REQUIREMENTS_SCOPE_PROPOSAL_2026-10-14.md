# M5 requirements and readiness: scope proposal (14 October 2026)

**PROPOSED, PENDING OWNER DECISION AND KNOWLEDGEABLE HUMAN REVIEW.** Claude (`claude-opus-5-5`). Documentation only: no source, schema, migration, dependency or rule data changes. Uncommitted in `/Users/rickymac/code/Flight-training-m5-requirements-scope`, branch `claude/m5-requirements-scope`, base `42077ccd00b70ad406e30d236a34e0ab556745d5`.

ROADMAP §10 asks M5 to "support one explicitly selected training path" with "versioned rule data with authoritative references, review date, qualifying inputs and missing-evidence rules", and to have regulatory content reviewed by a knowledgeable person. This document is the specification step that the roadmap requires before any rule data or UI is built. It is not legal or flight-training advice, and nothing in it is presented to the learner.

**Independent integration review:** suitable to publish as a proposal only. RQ-D1–D7 are not approved and no rule data is accepted. The reviewer corrected two inference gaps below: an instrument-time total is not proof of qualifying instrument training, and a planned test month alone is not proof of test-preparation training. Missing overlap, purpose, aircraft or instructor evidence stays unknown until confirmed; this does not replace the required knowledgeable human review.

## 1. What this feature is, and is not

**Is:** a checklist that shows, for one selected training path, each regulatory requirement she will need to meet. For each one it shows what her own records already show, what is still needed, and where the requirement comes from. It always shows the evidence and leaves the decision to her and her instructor.

**Is not:**
- an eligibility decision, a "you're ready" verdict, a pass probability or a percentage of a certificate (PRODUCT_SPEC §9);
- a replacement for her instructor's endorsements or the official logbook (PRODUCT_SPEC §8, "should not present itself as an authoritative replacement");
- a statement that an hour qualifies. The app can't see aircraft type, whether training was given by an authorized instructor, or simulator approval.

**Product-spec tension to resolve (RQ-D1):** PRODUCT_SPEC §43 lists "Automatic FAA requirement tracking" as not required for V1. ROADMAP §10 schedules it for M5. This proposal treats it as a reviewed, evidence-only checklist rather than automatic tracking. The owner should confirm that this reading is acceptable before implementation.

## 2. Proposed training path (RQ-D2)

**US Private Pilot certificate, airplane category, single-engine land class, under 14 CFR Part 61.** It is the path named in ROADMAP §10. The learner hasn't enrolled in a school yet (CLAUDE.md), so a Part 141 school's approved syllabus could later replace Part 61's aeronautical experience minimums. Part 141, sport/recreational, instrument, commercial and non-US paths are out of scope and need their own reviewed additions.

## 3. Authoritative sources consulted

The live eCFR (Title 14, Part 61) was read on **14 October 2026**. The content is paraphrased below; the rule data must quote section numbers, not reproduce regulatory text. Every source below carries the editorial note for FAA-2023-1275, Amdt. 61-157, 89 FR 92483 (21 Nov 2024). Re-check every source at implementation time and record the date checked.

| Section | Topic | Last substantive amendment shown |
|---|---|---|
| [61.103](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-E/section-61.103) | Private pilot eligibility | Amdt. 61-124 (2009) |
| [61.109(a)](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-E/section-61.109) | Aeronautical experience, airplane single-engine | Amdt. 61-157 (21 Nov 2024) |
| [61.39(a)](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.39) | Practical test prerequisites | Amdt. 61-157 (21 Nov 2024) |
| 61.87 | Student solo requirements and solo endorsement | Amdt. 61-135 (2016) |
| 61.93 | Student solo cross-country requirements and endorsements | Amdt. 61-135 (2016) |

**To be read by the reviewer before rule data is written:**
- 61.105 and 61.107(b)(1): knowledge areas and areas of operation;
- 61.35: knowledge test prerequisites;
- 61.23 and 61.113(i): medical, including BasicMed limits for student pilots;
- 61.109(k): credit for simulators and flight training devices;
- 61.110: the night-flying exception;
- 61.51: logbook entries and what counts as training time;
- the current Private Pilot Airplane ACS (FAA-S-ACS-6, latest change).

## 4. Requirement inventory and what the app can actually see

For each requirement: whether the app's current data can show it, and the evaluation outcome it may produce.

**Outcomes:**
- **Shown in your records:** her own entries meet the stated minimum. This is not a qualification decision.
- **Not yet:** her entries show the item is incomplete.
- **Not enough information:** a needed input isn't captured. This is the default whenever an input is missing, and never "Complete" (ROADMAP §10).

| ID | Requirement (paraphrase, with reference) | Inputs available today | Missing inputs | Possible outcomes in the first slice |
|---|---|---|---|---|
| R-AGE | At least 17 for an airplane rating (61.103(a)) | none | date of birth (deliberately not collected) | **Manual confirmation only** |
| R-ENG | Read, speak, write and understand English (61.103(c)) | none | n/a | Manual confirmation only |
| R-STU | Holds a student (or sport/recreational) pilot certificate (61.103(j)) | Toolkit credential `pilot_certificate` | its kind | Manual confirmation, linked to the credential record |
| R-MED | Medical certificate where required (61.39(a)(4); 61.23) | Toolkit credential `medical` with issue/expiry | class; BasicMed applicability | Shown/Not enough information; the expiry date is displayed, not interpreted |
| R-KT-END | Instructor endorsement for the knowledge test (61.103(d)) | Toolkit credential `endorsement` (free text) | which endorsement it is | Manual confirmation linked to a record |
| R-KT | Knowledge test passed within 24 calendar months before the practical test month (61.103(e), 61.39(a)(1)) | Toolkit credential `knowledge_test` with date | the practical test month | Shown, with the computed window end month; "Not enough information" without a date |
| R-T40 | 40 hours total flight time (61.109(a)) | journal `totalTime` | whether each hour qualifies (aircraft, sim credit under 61.109(k)) | Shown/Not yet, with the qualifying caveat |
| R-DUAL20 | 20 hours of flight training from an authorized instructor (61.109(a)) | journal `dualReceived` | instructor authorization | Shown/Not yet, with the caveat |
| R-SOLO10 | 10 hours of solo flight (61.109(a)(5)) | journal `soloTime` | none for the total | Shown/Not yet |
| R-XC3 | 3 hours of cross-country training in a single-engine airplane (61.109(a)(1)) | journal `crossCountryTime` and `dualReceived` per entry | which part of an entry's cross-country time was dual | Shown only when the entries are unambiguous (see RQ-D5); otherwise Not enough information |
| R-NIGHT3 | 3 hours of night training (61.109(a)(2)) | journal `nightTime`, `dualReceived` | dual/night split within an entry; 61.110 exception | As R-XC3 |
| R-NIGHT-XC | One night cross-country over 100 nm total distance (61.109(a)(2)(i)) | none | distance, night status of the flight | **Not enough information**, or manual confirmation |
| R-NIGHT-LDG | 10 night takeoffs and 10 full-stop landings, each with a traffic pattern (61.109(a)(2)(ii)) | journal `nightLandings` | full-stop vs touch-and-go; night takeoffs | Not enough information, or manual confirmation |
| R-INST3 | 3 hours of training by reference to instruments (61.109(a)(3)) | journal actual and simulated instrument time | qualifying training purpose, aircraft and instructor evidence; overlap with instrument time | Not enough information until the qualifying training is explicitly identified; raw instrument totals alone cannot produce Shown |
| R-PREP3 | 3 hours of test-prep training within 2 calendar months before the test month (61.109(a)(4)) | journal `dualReceived` and `date` | the practical test month; which training was specifically test prep; qualifying instructor/aircraft | Not enough information until both the planned month and qualifying test-preparation entries are identified; ordinary recent dual time is insufficient |
| R-SOLO-XC5 | 5 hours of solo cross-country (61.109(a)(5)(i)) | journal `soloTime` and `crossCountryTime` | solo/cross-country split within mixed entries | As R-XC3 |
| R-LONG-XC | One solo cross-country of 150 nm total, full-stop landings at three points, one leg over 50 nm (61.109(a)(5)(ii)) | departure/arrival airports only | distance, intermediate stops | **Not enough information**, or manual confirmation |
| R-TWR3 | 3 solo takeoffs and full-stop landings at a towered airport (61.109(a)(5)(iii)) | none | tower status, full-stop | Not enough information, or manual confirmation |
| R-SOLO-END | Solo endorsement for the make and model, renewed every 90 days (61.87(n), (p)) | Toolkit credential `endorsement` with date | make/model | Manual, with the date shown; informational, not a test prerequisite |
| R-XC-END | Solo cross-country endorsements (61.93(c)) | as above | as above | Manual, informational |
| R-PT-END | Practical test endorsement: training within 2 calendar months, prepared, knowledge-test deficiencies reviewed (61.39(a)(6), 61.103(f)) | Toolkit credential `endorsement` | which endorsement | Manual confirmation linked to a record |
| R-APP | Completed and signed application (61.39(a)(7)) | none | n/a | Manual checklist item |

**Conclusion of the gap analysis:**
- Journal totals are candidate evidence, not proof of qualifying training. In particular, raw instrument time cannot establish R-INST3, and recent dual time plus a planned month cannot establish R-PREP3 without training-purpose evidence.
- Seven requirements can't be shown from current data at all. Each must stay **Not enough information** until she confirms it manually or a reviewed data-capture change is approved.
- Calendar-month windows (knowledge test, test-prep training, endorsement timing) need a planned practical-test month that the app doesn't store.

## 5. Proposed rule data shape (RQ-D3)

A versioned, read-only rule set is bundled with the app source. It is not stored in her database, so a rule update never rewrites her data.

```text
RuleSet
  id: "us-part61-ppl-asel"
  version: integer (bumped on any change)
  reviewedOn: date              // human review date, required
  reviewedBy: string            // reviewer role, not a personal name, unless agreed
  sourcesCheckedOn: date        // eCFR check date
  references: [{ section, amendment, url }]
  requirements: [
    { id, label, reference, kind: hours | count | window | endorsement | credential | manual,
      minimum?, inputs: [journal field | credential type | manual],
      ambiguityRule?,            // when a mixed entry makes the value unknown
      caveat }                   // always-visible "what the app can't verify"
  ]
```

**Rules:**
- An evaluation is a pure function of (rule set, journal entries, credential records, manual confirmations, and an optional planned test month), with an injected "today".
- An evaluation never returns a single overall status.
- Changing the rule set version shows "rules updated on …" and never silently changes a past manual confirmation.

## 6. Proposed decisions for the owner

| ID | Proposal | Alternative |
|---|---|---|
| RQ-D1 | Treat M5 requirements as an evidence-only checklist, consistent with PRODUCT_SPEC §43, rather than automatic tracking | defer M5 requirements until after V1 |
| RQ-D2 | One path: Part 61 PPL ASEL (§2) | wait until she chooses a school/Part 141 syllabus |
| RQ-D3 | Rule data bundled in source, versioned, with mandatory `reviewedOn` (§5) | user-editable requirement lists only (the existing Toolkit readiness items) |
| RQ-D4 | **First slice with no schema change:** derive from the journal and Toolkit credentials. Manual confirmations and the planned test month live in the existing `pilot_toolkit` JSON state, with a normalizer that adds the new fields to older states (the pattern `normalizeToolkitState` already uses) | a new migrated table, which conflicts with M4's provisional 0015 and needs backup/restore review |
| RQ-D5 | Any entry whose overlap is not established makes the qualifying split **unknown**, including dual plus solo and partially allocated dual with cross-country/night time. Zero solo alone does not prove every hour was dual. Affected sub-requirements show Not enough information with the ambiguous-entry count | ask her to split entries (more typing; error-prone) |
| RQ-D6 | Keep the existing Flight Log "Part 61 reference" bars for now, and link them to the new checklist; do not add percentages to the checklist | replace the bars |
| RQ-D7 | Distances, full-stop landings, towered airports and night cross-country stay **manual confirmations** in this slice. Capturing them in the journal is a separate, reviewed data-capture change | extend the journal form now |

## 7. Acceptance criteria for the first implementation slice (after approval)

- **Rule fixtures** for every requirement: qualifying, non-qualifying and unknown cases, including:
  - mixed entries (RQ-D5);
  - instrument hours without qualifying training purpose, and recent dual hours without practical-test-preparation purpose (both remain unknown);
  - zero hours;
  - null fields vs 0;
  - a knowledge test exactly 24 calendar months before the test month, and one month outside;
  - test-prep training on the first and last day of the 2-calendar-month window;
  - no planned test month;
  - an expired medical date shown as a fact, not a verdict.
- **Wording:**
  - no "Complete", "Eligible", "Ready" or percentage at the rule-set level;
  - each "Shown in your records" line carries its caveat;
  - every line links to its reference.
- **Data safety:**
  - manual confirmations and the planned month survive export/restore;
  - an older Toolkit state loads with the new fields defaulted;
  - a newer rule version never changes a stored confirmation.
- **Injected clock:** calendar-month windows are tested across month and year boundaries and in the local zone.
- **Human review:** before the slice can merge, a knowledgeable reviewer (a CFI or equivalent, chosen by the owner) signs off the rule data and wording, with the date recorded in `reviewedOn`.

## 8. Open questions for the knowledgeable reviewer

1. Should simulator/FTD time (61.109(k)) be excluded from the totals by default, given that the journal doesn't mark it?
2. 61.110 night exception: show it as a note only, or omit it?
3. BasicMed and student pilots: what should the medical line say, given 61.23 and 61.113(i)?
4. Is the RQ-D5 rule (mixed entries → unknown split) acceptable, or is a different convention standard for logbooks?
5. How should "calendar months" be shown to her: the window's end month only, or both start and end?
6. Should the solo and solo cross-country endorsements (61.87, 61.93), which have operational currency rather than test prerequisites, appear on this checklist or only in Toolkit reminders?

## 9. Noticed in passing (no change made)

- The Flight Log "Part 61 reference" (`privatePilotPart61Reference` in `src/logic/flightLog.ts`) shows percentage bars against 40/20/10 hours. They are labelled as a reference, not eligibility, which PRODUCT_SPEC §9 permits only for clearly defined requirements. RQ-D6 proposes keeping them and linking them to the checklist.
- The cost analytics half of M5 is implemented separately and is pending review (`claude/m5-training-cost-analytics`, see `docs/M5_TRAINING_COST_ANALYTICS_REPORT_2026-10-14.md` in that worktree).

## Proposed tracking entry (for the integrator)

> **M5 requirements scope proposed — 14 October 2026.** A documentation-only specification for one Part 61 PPL ASEL evidence checklist, based on the live eCFR read on 14 Oct 2026. It shows evidence, caveats and three outcomes ("Shown in your records" / "Not yet" / "Not enough information") and never gives an eligibility verdict. Seven requirements can't be shown from current data and stay manual. Decisions RQ-D1–D7 await the owner, and the rule data needs knowledgeable human review before implementation. [Proposal](M5_REQUIREMENTS_SCOPE_PROPOSAL_2026-10-14.md).
