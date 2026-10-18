# Study Guide hub: owner-approved roadmap

## Approval and delivery order

On 17 October 2026, the owner approved all eight proposed improvements: “i love all those ideas lets add them to the roadmap”. This approves the product directions and their order, not an unreviewed dependency, data migration, provider integration or implementation.

The Study Guide becomes the central study hub, backed by the original documents. Saved guides, cards, questions, study recommendations and lesson preparation should share explicit source and topic relationships. Original publications retain their identity and revision; generated explanations remain distinguishable from source text and instructor corrections.

Keep the current P54 queue and the active calendar-export assignment intact. These are follow-on outcomes after the existing approved queue; work already delivered under P54-01/02/05/06/08 can satisfy overlapping criteria when verified. Extend those systems rather than creating parallel source-link, scheduling or lesson-preparation systems. Do not silently reorder current work. The sequence below is the recommended foundation first: source references, connected topics, and correction/version handling before more adaptive or AI behavior.

## STUDY-HUB-01 — Source-linked explanations

Every guide section should identify its supporting document revision and page or passage. Cards and quiz explanations retain the same source relationship. Opening a reference uses the accepted document-navigation contracts, with PDF page, printed-page label and split-document coordinates distinguished.

Acceptance: references resolve to the correct managed content; missing, replaced, deleted and unverified sources are explained honestly. Test document replacement, split/page mapping, stale operations and offline use. A syntactically valid page number alone does not verify that an explanation is supported. Reuse P54-01 and reviewed P54-02 extraction work.

## STUDY-HUB-02 — Connected topics across the app

One topic, such as Crosswind landings, connects its guide sections, cards, missed questions, instructor questions and linked lessons. Users can return from a practice result or lesson to the relevant explanation.

Acceptance: topic membership and origin are visible; unrelated records do not become linked automatically. Avoid merging aircraft-specific procedures or limits into generic facts. Test renamed/deleted topics, multiple source revisions, regeneration, navigation and backup/restore. Preserve existing material and review identities.

## STUDY-HUB-03 — Corrections and version handling

Users can flag confusing or incorrect explanations and record instructor corrections. Show which derived cards and questions depend on the corrected content. Regeneration previews changes and preserves deliberate edits and historical attempts. A replaced source identifies derived material needing review.

Acceptance: corrections have provenance and version identity; no automatic rewriting of historical results or silent loss of edits. Test cancellation, failed saves, repeated submissions, source replacement and restore. Instructor notes remain private unless deliberately included in an output. Design and independently review any required storage migration before adoption.

## STUDY-HUB-04 — Explainable next study session

Offer a manageable session using missed questions, due cards and the next lesson. Explain each recommendation, for example: review this section, answer three questions, then revisit five cards.

Acceptance: deterministic, testable selection with a practical session budget, clear reasons and source destinations; handles no history, missing sources and overdue backlogs. Reuse the existing daily-plan selector and P54-06 scheduling work. Keep completion, recall and proficiency distinct; recommendations do not certify readiness to fly.

## STUDY-HUB-05 — Better wrong-answer explanations

Explain the chosen answer's mistake, why the correct answer fits and where to read more. Offer occasional explain-in-your-own-words prompts alongside recognition questions.

Acceptance: explanation matches the exact historical question/version and source; no invented rationale presented as source evidence. Keep answer reveal/scoring rules intact. Record self-assessment separately from automatically scored answers unless a reviewed assessment contract is approved. Test missing references, disputed questions, retries and historical retention.

## STUDY-HUB-06 — Questions grounded in selected documents

Let users ask questions of deliberately selected documents, with concise answers and specific source references. Identify unsupported answers and conflicting sources. Keep aircraft-specific guidance associated with its aircraft and publication revision.

Acceptance: retrieval is bounded and selection-scoped; distinguish source quotations, generated explanations and unavailable evidence. Test scans, extraction failures, conflicting revisions, irrelevant passages, malicious instructions embedded in documents, cancellation and offline behavior. Use only reviewed P54-02 retrieval foundations; source citations alone do not prove factual support. Provider use needs an explicit user action and clear disclosure of what selected content leaves the Mac; this roadmap approval does not authorize provider calls during development.

## STUDY-HUB-07 — Lesson preparation from study activity

Before a lesson, offer relevant reading, troublesome topics and questions the user deliberately chooses to ask. After a lesson, selected instructor feedback can become follow-up study. Later, reviewed ACS mappings can organize knowledge, risk management and skills.

Acceptance: suggestions explain their origin, remain editable and do not automatically publish journal or instructor content. Reuse P54-05 briefs, existing actions/questions and P54-08 FAA references. Test changing lessons, repeated acceptance, stale operations, privacy exclusions and retained history. ACS mappings require publication provenance and knowledgeable human review.

## STUDY-HUB-08 — Visible document-processing quality

Show whether a document is ready to study, processing, missing readable text or awaiting OCR. Identify incomplete extraction and the portions actually available. A scanned or partially processed handbook must not appear comprehensively covered by its guide.

Acceptance: durable, understandable states with bounded retry/cancellation, recovery after restart, replacement invalidation and no misleading complete state. Test text PDFs, scans, mixed-content pages, partial extraction, corrupt files and restore. OCR remains a separate reviewed implementation decision; this item does not silently adopt an engine. Basic missing-text detection remains a prerequisite wherever earlier source/retrieval work needs it, without changing the eight-item product order.

## Shared completion rules

- Preserve local imported originals, user edits, review history and complete backup/restore behavior. Saved content remains usable offline.
- Keep study aids advisory and source identity visible; document age, conflicting guidance and aircraft applicability must not disappear through aggregation.
- Define acceptance criteria and a bounded implementation slice before coding. No new database, cloud synchronization, provider, package or OCR engine is adopted solely by this document.
- Use focused, meaningful tests and reuse valid unchanged-source evidence. Keep normal independent review and exact-head CI gates. Source tests do not establish installed printing, native-reader behavior, accessibility or release readiness.

## Rationale sources

Retrieval practice and spacing inform the study-session and feedback directions: [IES practice guide](https://ies.ed.gov/ncee/wwc/PracticeGuide/1). FAA coverage should use the applicable published [Airman Certification Standards](https://www.faa.gov/training_testing/testing/acs), with mappings reviewed before publication. These sources support the direction; they do not validate this app's eventual implementation.
