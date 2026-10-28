# FAA-01: a small offline reference shelf — 28 October 2026

**Plan only; the owner has not approved the FAA shelf.** Recommendations below need their decision before implementation.
Inspected `87dd211d0fc731da2ea9893312cfed9ae06af4a4`, branch `roadmap/faa-01a`.
P54-08 coordinates FAA-01 airport data, FAA-02 references, M3 skills and M4 source navigation; preserve the existing queue after WX-01.
No app code, dataset/PDF body download, dependency, migration, profile access, commit, push or release is part of this round.

## The student experience

A small **FAA references** section inside Study Library: the books she chose to keep, available without internet.
She can open her saved Private Pilot ACS or Pilot’s Handbook of Aeronautical Knowledge (PHAK) before a discovery flight or study session.
No school, enrolment, instructor, home airport or account is required. Nothing changes study completion or flight readiness.
**Smallest useful first slice:** two optional document entries, add the locally chosen files, show edition/source and availability, open them offline.
Include PHAK’s addendum alongside its book. Do not build another library, dashboard, reader, course or automatic study plan.

Later, if useful, she types an airport identifier and checks its name/city before reading saved runway dimensions and radio purposes/frequencies.
That lookup uses a locally imported NASR cycle; it neither selects a runway nor recommends which frequency to use.
After human review, an existing task/skill/question may offer **Open FAA reference**, naming the exact edition and page.
Use M4’s external-reader fallback: “Opened in your PDF reader. Go to PDF page … (printed page …).” Never promise a page jump.
Keep ordinary keyboard controls, readable units/dates, calm missing-file messages and 44px targets; check narrow views and 200% text.
Always label airport results **“For study and lesson preparation — not for navigation. Check current official sources and your instructor.”**
NASR is not a briefing, NOTAM service, chart, airport diagram, live closure report or operational clearance.

## Reuse the existing foundations

| Existing source | Reuse and boundary |
| --- | --- |
| `src/logic/currentPrivateAirplaneAcsCatalog.ts`, `currentAcs*Catalog.ts` and catalog tests | Already aggregate 61 FAA-S-ACS-6C tasks / 1,170 codes, with publication, effective date, printed/PDF pages and official URL. Do not make a second ACS catalog. |
| `src/logic/aktrAcsEdition.ts`, `aktrCodeCatalog.ts` | Keep current/archived/unresolved semantics; do not invent replacement codes. The edition resolver is verified only through 2026-10-23; today’s index check does not extend that code window. Reverification is future reviewed work. |
| `src/logic/acsStudyMaterialLinks.ts`, `acsAreaMaterialCoverage.ts`, `AcsCodeLookupPanel.tsx` | Reuse exact-code tag lookup and existing destinations. A tag match/count is reading availability, not human approval, answer correctness or proficiency. Never auto-tag these books to make every code appear covered. |
| `src/services/documents.ts`, M4 navigation and `navigation/SourcePageBadge.tsx` under StudyLibrary | Reuse managed local import, Open/Reveal, missing-file handling, bookmarks and honest page guidance; no embedded viewer adoption. |
| `src/data/studyPageSources.ts` | Reuse original-byte hash, physical page versus printed label and frozen source/history protections when task links are later approved. They do not record aviation-content review. |

M3 already has stable built-in/custom skill IDs and attributed observations; a new shelf must not infer ACS mappings from broad topics or feedback.
This proposal adds no mappings or changes to existing user tags, saved study, archived references or skill history.

## Official sources and size evidence

Checked official HTML/readme pages read-only on 28 October 2026; PDF sizes below are HTTP HEAD Content-Length, with no PDF bodies fetched.
Numbers are transfer metadata, not decoded memory, verified hashes or a redistribution audit; recheck them before implementation.

| Source and official page | Version/effective information | Size and proposed use |
| --- | --- | --- |
| [NASR index](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/), [1 October cycle](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/2026-10-01/) | Index lists current effective **2026-10-01**, preview **2026-10-29**; 28-day publication cycle. | APT (airports/landing facilities, candidate runway source), ATC (communications), FRQ (frequency data) CSV groups. Their ZIP byte sizes and expanded sizes are **unverified**: all three HEAD requests returned 503; cycle HTML gives no sizes. |
| [Cycle README](https://nfdc.faa.gov/webContent/28DaySub/2026-10-01/README.txt) and [29 October preview](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/2026-10-29/) | README documents changes and `APT_*.csv`, `ATC_*.csv`, `FRQ.csv`; preview is not today’s effective data. | README is 24,237 bytes. CSV field layouts, runway members, join keys, units and frequency coverage still require inspection after dataset acquisition is approved; do not assume FRQ alone supplies every airport radio. |
| [Private Pilot Airplane ACS index](https://www.faa.gov/training_testing/testing/acs), [6C PDF](https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf) | FAA-S-ACS-6C, published April 2024, effective 2024-05-31; listed by today’s index. | 716,798 bytes; reuse current catalog, optional local book. No claim to the real FAA question bank. |
| [ACS Companion Guide](https://www.faa.gov/training_testing/testing/acs/acs_companion_guide_pilots.pdf), linked by ACS index | FAA-G-ACS-2 with Changes 1 & 2, as the index labels it; exact internal revision dates not inspected. | 489,586 bytes; optional later supporting reference for existing archived-code handling. |
| [PHAK](https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/phak), [handbook index](https://www.faa.gov/regulations_policies/handbooks_manuals/aviation) | FAA-H-8083-25C, 2023; index also lists October 2025 MOSAIC addendum. Publication dates are not NASR effective cycles. | Full book 77,598,564 bytes (~74.0 MiB); [addendum](https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/PHAK_Addendum_(MOSAIC).pdf) 263,376 bytes. First-slice choice. |
| [Airplane Flying Handbook](https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/airplane_handbook), handbook index above | FAA-H-8083-3C, 2021, plus October 2025 MOSAIC addendum. | Full book 273,248,888 bytes (~260.6 MiB); [addendum](https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/AFH_Addendum_(MOSAIC).pdf) 197,928 bytes. Defer the large book unless wanted. |

**Reuse status:** original US federal-government works are public domain in the US under 17 USC 105, not an MIT/CC licence.
That is the basis for FAA-authored NASR data and ACS/handbook text; it is not a blanket licence for every credited illustration or third-party contribution.
[Library of Congress guidance](https://www.loc.gov/legal/security-copyright-and-privacy/understanding-copyright/) describes government-work public domain; [USAGov’s reuse guidance](https://www.usa.gov/government-copyright) notes third-party exceptions. The FAA handbook index places reproduction/modification responsibility on the publisher.
Before bundling or redistributing any selected bytes, inspect that edition’s notices/credits and record exceptions; do not imply FAA endorsement.
No per-file rights audit was performed here. Recommend user import first and no repackaged diagrams, commercial manuals or FAA seals.

## Offline intake, storage and refresh

| Approach | Recommendation |
| --- | --- |
| Bundled | Only a small versioned source-metadata list plus existing ACS code data. No NASR ZIPs or handbook PDFs in Git/installers for this first slice. |
| User-imported | Default. Owner obtains selected official files separately; she deliberately adds local copies through existing managed-document intake. App makes no network request. |
| Downloaded on request | Defer. If later approved, one explicit owner action per named publication/cycle; show size, destination and source before starting. No background checks, polling, retry or fetch on open. |

**Documents first, no migration:** use existing Reference materials, managed copies, metadata/notes and bookmarks.
Show publication ID, edition/addendum, official source URL, publication/effective dates where known, date added and last source check separately.
Retain a small checked source list in code; record local edition/source notes using existing fields. A user’s filename/title is not proof of official bytes.
Label unverified imports “Edition not checked”; verify exact bytes/page count before claiming a checked source or exposing a reviewed page link.
Acquire/hash official bytes outside Git only in a separately authorized round; no trusted PDF hashes are established by this plan or HEAD metadata.
Do not overload ACS tags, card JSON or private page-source bindings as a new publication/review database.
Existing managed files, notes and bookmarks follow complete-backup/deletion behavior; disclose large backup cost and retain old editions as separate materials.
Do not silently replace files behind existing bookmarks/cards; missing/changed originals retain history and show an unavailable/unverified source.
Any need for a new publication/link table is an **owner gate for an add-only migration** with backup/restore/delete validation, before durable links ship.

**NASR later:** propose a separate replaceable local reference directory, with immutable cycle files and a manifest, outside managed personal documents/SQLite.
Manifest records official cycle/source URLs, effective start and next-cycle boundary, import time, actual byte counts/hashes, parser/schema version and selected groups.
Use a bounded local index derived from that cycle; do not place nationwide CSV rows in training tables or load all rows into React.
Validate all groups as one cycle, stage completely, then atomically switch active manifest; failed/cancelled import keeps the prior cycle unchanged.
Keep active and previous cycle only, with cleanup after successful activation. Confirm byte/entry/expanded-size/disk limits before assigning NASR intake;
missing size/layout evidence is a prerequisite for that slice, not permission to accept an unlimited ZIP or add a parser dependency.
Proposed NASR cache is excluded from training backups/exports; prove exclusions and show “Re-import airport references” after restore on a new device.
No saved airport favourites or lesson association initially: typed identifier is session-only. Persistent associations would be personal data and a separate owner/storage decision.

NASR refresh is a manual replacement each 28-day cycle, not 28 days after import. Show cycle date, effective range, imported date and source on results.
Confirm the official activation instant/time zone from publication documentation before implementing the boundary; never guess local midnight.
Before start: “Next cycle — not effective yet”; after end: “Older cycle — update before use”; missing dates/clock uncertainty: “Cycle dates could not be checked”.
Retain older results for study with the permanent “not for navigation” label; never label preview/unknown/expired data current or reset age on failed refresh.
Books/ACS refresh by publication revision and addendum, not the NASR timer: “Saved edition …; source last checked …; newer editions may exist.”
Opening offline never claims an online currency check. Check official indexes manually at intake and before approving new links; preserve prior reference identities.

## Mapping and knowledgeable human review

Before review, the new shelf ships **no mappings**: only unmapped books and, if separately approved, airport facts with provenance.
No shelf-generated handbook-to-ACS, skill-to-ACS, question/answer-to-ACS or task-to-page links are visible to her, including “suggested” links.
Do not send candidate mappings to her as a review queue. Ordinary user bookmarks remain her choices, not reviewed FAA mappings.
An instructor or another owner-approved knowledgeable reviewer must check exact source content, page, applicability and each proposed ACS element.
This includes new direct catalog-to-local-PDF destinations: source/page identity must be checked before releasing the link.
Record review in a versioned, repository-held mapping manifest plus a human review report: stable mapping ID, M3/task ID where relevant,
certificate/category, ACS edition and full element code, handbook ID/edition/addenda, source URLs/hashes, physical page and printed label,
reviewer’s agreed public identifier/qualification, review date, rationale/corrections, accepted/rejected status and exact manifest revision/hash approved.
No student content or private instructor contact details go in that report. A technical reviewer verifies the evidence but cannot substitute for content expertise.
Only accepted entries tied to the approved manifest and verified source bytes may be exposed; an absent record means unavailable, never implicitly approved.
Changing edition, content hash, ACS element or page invalidates approval for that destination and requires another human review.
Retain prior mapping versions and study references; never rewrite historical questions or carry an old mapping forward automatically.
No score, eligibility determination, instructor endorsement, AI grounding or generated-question correctness follows from a reviewed link.

## Bounded slices and owner decisions

**01b — document shelf:** after plan approval, ACS + PHAK/addendum local import, provenance/availability and offline Open using existing storage.
No new mappings or network. Accept missing/wrong-edition handling, backup/restore and browser/native fallback before any follow-on assignment.
**01c — airport reference:** separately approve after usefulness is established; validate source layouts/sizes first, then user-import APT/ATC/FRQ,
exact identifier/name lookup and bounded offline runway/radio display with cycle handling. No map, weather-station inference or live briefing.
**01d — reviewed destinations:** separately approve a handful of useful task/skill links after the human review above; reuse M3/M4 identities/history.
Automatic acquisition is not included in those slices; propose it separately only if manual import proves burdensome. Stop for independent review after each slice.

| Owner choice | Recommended default |
| --- | --- |
| D1 — Approve shelf/order and first slice? | Approve only 01b after reviewing this plan, at P54-08’s existing position; shelf remains unapproved until then. |
| D2 — Training scope/books? | Optional Private Pilot Airplane ACS 6C + PHAK 25C/addendum; no enrolment required. Defer AFH/other certificates until requested. |
| D3 — Network: none or owner-triggered? | **None in the app.** User imports owner-obtained files; separately approve any later explicit FAA-only native download. |
| D4 — Bundling/storage/schema? | Metadata only bundled; managed document imports and existing fields, no migration. Any new table/dependency/backup format returns to owner. |
| D5 — Airport scope and refresh? | Defer 01c; if approved, user-import one complete same-cycle APT/ATC/FRQ set, session-only identifier, manual 28-day refresh and labelled older study data. |
| D6 — Mapping/reviewer? | Zero new mappings before owner-approved knowledgeable human review; small versioned manifest/report for 01d, no instructor account. Owner names reviewer before assignment. |
| D7 — Retention/backup? | Imported books/history use existing complete backup; no silent replacement. NASR later is replaceable cache, active + previous cycle, excluded from training backups/exports. |

## Risks and synthetic acceptance

Use authored fictional airports/runways/radios and tiny synthetic PDFs only; injected clocks and loopback fixtures if transport is later approved.
Test local/ICAO identifiers separately (no automatic K-prefix), collisions, unknown/removed airports, missing ICAO, closed/private facilities and missing radios.
Show “Not in this saved cycle” or “Not reported”, never infer nonexistence, zero dimensions, no tower or permission to land from absent data.
Verify APT/runway/ATC/FRQ joins against official layouts; no nearest-airport substitution, unrelated radio merge or inferred frequency purpose.
Test feet/metres, MHz/kHz, decimal precision/trailing zeros, nulls, runway-end labels, magnetic/true headings and unsupported units; do not invent conversions.
Exercise CSV quoting/encoding, changed/duplicate headers, mixed cycles, truncated files, unexpected members, path traversal/symlinks, ZIP bombs and size bounds.
Test effective-boundary rollover, preview activation, clock/DST changes, stale offline restart, cancelled/failed replacement and rollback without mixed-cycle results.
Cover same-name/different-byte editions, addenda, removed codes, printed/PDF page offsets, missing/changed files, rejected/missing review and review invalidation.
Keep saved answers/ratings and historical citations unchanged through refresh, delete and restore; unavailable sources never silently relink.
Privacy: lookup/import/open sends nothing about her, airport selection, lessons, notes, documents or progress; no Gemini, analytics or hidden fetch.
If future owner-triggered downloading is approved, request only fixed public publication/cycle URLs, never selected airports/profile data; disclose ordinary IP/TLS metadata.
That future network slice must bound host/redirects, bytes, time, cancellation and atomic writes; no new opener/CSP permission is implied here.
Acceptance includes cold offline Open, backup/restore, keyboard/VoiceOver, narrow/large text and native external-reader fallback in a fictional profile.
Reviewer applies the current AGENTS gates/mutations to implementation; this planning round runs no app suite and proves no installed/live-data/release behavior.
