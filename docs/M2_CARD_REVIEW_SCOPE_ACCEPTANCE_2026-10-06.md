# M2 card-review scope — independent planning acceptance, 6 October 2026

**Decision: accept the corrected scope for planning. CRS-R1 and CRS-R2 are closed.** All eight recommended defaults remain unchanged. The [corrected scope](M2_CARD_REVIEW_SCOPE_2026-10-06.md) and [complete model-neutral C1 assignment](M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md) are ready for the owner's production-scope decision. No production implementation, dependency or migration is authorized by this report.

## Identity and independent verification

The Mac submission remains on `codex/m2-card-review-scope` in `/Users/rickymac/code/Flight-training-pr70-integration`, base `df7a130f595abda787b4377850ab7095bde33824`. All **four corrected proposal/status hashes**, **18 correction-evidence checksums** and **10 current proof checksums** verify. The acceptance branch starts from current main `c66e3a58a806f9fb7f9e976ab71206fbdbfb85f2` and preserves current-main status/history.

Independent command: `node --test --test-reporter=spec proof.test.mjs corrections.test.mjs`, Node 22.23.3. Result: **48 passed / 0 failed, exit 0**. This includes the original 27 (six operation cases adapted to legitimate generation-bearing shapes) and 21 correction cases. The unchanged scheduling arithmetic/identity/library evidence is reused; no whole-app matrix or repeat library survey is necessary for this planning change.

Production `src/`, `src-tauri/`, migration/checksum registries, package manifests/locks, active workflows and configuration remain unchanged. The implementer's dirty checkout, earlier receipts and saved stashes are not modified during review. Its four original documents are frozen in the independent acceptance evidence before reviewer status/handoff additions.

## Closed findings

| Finding | Independently verified corrected behavior |
| --- | --- |
| CRS-R1 — Again exact time | Minute nine excludes the card; minute ten includes it. Day-ladder cards use an exclusive next-local-midnight bound, with stored UTC instants unchanged. |
| CRS-R1 — current content | Due SQL joins the current derived version. Before B materializes, its cards are new and A's retained states stay out of the queue. A→B→A reuses A's own retained schedule. |
| CRS-R1 — bounded queue | Suspended/flagged cards are removed before limits. Ordering is Again, other due, new, with stable ties; 10-new/20-total caps are applied after eligibility. Session membership is fixed and replay cannot advance twice. |
| CRS-R2 — reset barrier | Every action captures the material's generation. Reset advances it, so uncommitted old revision-0 and revision-1 requests are rejected even when item revisions repeat. |
| CRS-R2 — replay/erasure | Replay is resolved first; an acknowledged reset replay does not erase later work or advance again. Repeated reset safely skips existing tombstones, uses independent routing metadata and leaves unrelated materials intact. |
| Completed handoff | Reset has its own typed action, schema and UI confirmation. First suspend/flag creates no rating event; snapshot creation and first review times are distinct. Acknowledged/replayed write followed by failed refresh keeps editing locked. |

The scope and conditional prompt consistently carry these contracts into native/browser transactions, rollback/storage-recovery tests, shared startup/archive validator fixtures and accessible UI work. The proof uses representative node:sqlite tables and an in-memory operation model. It does not establish native/sql.js atomic persistence, installed behavior or application release readiness; C1 must prove those source guarantees on the actual drivers.

## Mutation evidence qualification

The submitted Q1 receipt fails with `Unknown named parameter 'nowUtc'`: the mutation removes that SQL placeholder but leaves its binding supplied. It proves a broken mutation execution, not a semantic timing assertion. The claim that this receipt killed the timing defect is therefore too strong; the original receipt and summary remain preserved.

The reviewer reintroduced the end-of-day-for-every-card mistake in a disposable scratch copy while retaining a valid nowUtc binding. The corrected test then fails on **the actual minute-nine eligibility assertion**, plus the ordering/cap assertion: **19 pass / 2 fail, exit 1**, no binding error. This supplies meaningful independent sensitivity evidence and requires no additional implementer correction round. Submitted Q2/G1/G2 receipts and all restored file hashes remain preserved; no mutation quota is an acceptance condition.

## Reviewer handoff clarifications

Two narrow engineering clarifications are included in the published scope/assignment without changing C-D1–C-D8:

1. A valid empty saved card array is `none`, not damaged content. Accepted guide-only packets legitimately store empty flashcards; their guides stay available and no zero-item version is materialized. Malformed JSON/invalid nonempty cards remain a distinct failure.
2. Read-only **Check again** cannot establish acknowledgement of a particular reset merely because the generation changed. Keep the pending operation until same-ID replay, an authoritative operation-receipt read, or a definitive refusal resolves it. Never issue an automatic new reset.

These complete the implementation handoff. They are not claims that the corresponding production code already exists.

## Final recommended defaults, pending owner approval

| ID | Recommended default |
| --- | --- |
| C-D1 | Versioned deterministic `simple-v1` scheduler. FSRS deferred. |
| C-D2 | Again 10 minutes; first Hard/Good 1 day, Easy 3 days; ladder 1,3,7,16,35,75,150,180 days. Hard stays, Good rises one, Easy two; maximum 180 days. |
| C-D3 | Exact-content version identity; changed content starts fresh; identical content can reuse its retained history. |
| C-D4 | Material deletion removes its card review history; explicit Reset clears schedule/ratings while keeping current cards, guide and practice. Non-content replay barriers remain; older backups are unaffected. |
| C-D5 | Again uses exact due time, other cards their current local due day; 10 new/20 unique presented cards per session; clock rollback refused. |
| C-D6 | Suspend/flag excludes due/new work while retaining history until resumed/unflagged. |
| C-D7 | MaterialDetail review and recent history first; cross-material views later. |
| C-D8 | No new production dependency. |

**Next step:** the owner may approve all eight defaults in one message, or specify changes. Codex records that decision in a dated note and activates the [C1 prompt](M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md) from clean published main. Until that note exists, C1's activation condition remains unmet. The earlier [correction assignment](M2_CARD_REVIEW_SCOPE_CORRECTIONS_PROMPT_2026-10-06.md) is complete and superseded for the next task.

[Acceptance evidence](evidence/m2-card-review-scope-acceptance-2026-10-06/README.md) contains exact independent receipts and separate submitted/publication/evidence hash roots. GitHub's containing docs-only PR is the publication/check record. Accepted practice-session PR2, the check-in waiver and unresolved installed/signing/release prerequisites remain unchanged.
