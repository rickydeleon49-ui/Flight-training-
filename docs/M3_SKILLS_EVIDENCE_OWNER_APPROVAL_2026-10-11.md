# M3 skills/evidence owner approval — 11 October 2026

**APPROVED: M3-D1–D9 as written, and the first M3 production implementation slice.**

Owner statement in this conversation: “i approve claudes task”. This directly answers the preceding question asking whether the owner approves the nine M3 proposed defaults as written so the implementation model can begin production work. All nine defaults are approved without modifications, including append-only observation history, source-deletion retention, explicit permanent erasure and the limitations of earlier backups.

Independent preparation acceptance is recorded in [the acceptance report](M3_SKILLS_EVIDENCE_SCOPE_ACCEPTANCE_2026-10-11.md), published by PR #136 at `be41d1a3026aea9c9186cdc5775f71931202196b`. Both conditions of the earlier conditional implementation prompt are now satisfied.

## Approved source identity

| Document | SHA-256 at approval |
| --- | --- |
| `docs/M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md` | `14ba4a1b409a62b049f2cb87d415d3c606124e674b77f7cb8665b083f96d2886` |
| `docs/M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md` | `ba58b2ac6a3e712328dadd1a43a82adece5cde4014facf8695066260adf93d99` |
| `docs/M3_SKILLS_EVIDENCE_SCOPE_ACCEPTANCE_2026-10-11.md` | `5cb685444c1b1af4784a85ec054cd2aa3211ef3fa03b1166bc67603a82921a9a` |

The table below is copied from the reviewed scope's nine owner decisions. The scope/report's earlier PROPOSED wording remains a historical submission; this decision supersedes it without modifying frozen evidence.

## Approved defaults

| # | Decision | Recommended default | Impact |
| --- | --- | --- | --- |
| **M3-D1** | Skill catalog | A small built-in catalog v1 of **15 plain-language skills** with permanent `builtin.*` ids, such as `builtin.crosswind_landing`. Built-in names are read-only to her. A future catalog version ships as an additive migration that appends a revision. Custom skills get `custom.<uuid>` ids, up to **200**. Two *active* skills may not share a name (case and spacing ignored); a retired skill's name may be reused. **No ACS codes in v1.** | Stable identity without claiming official FAA elements. FAA-02 mappings stay a separate, source-verified task. |
| **M3-D2** | Skill status | Learning / Practicing / Needs review, **set only by her**, with "Not set" as the default and a way to clear it. Evidence, quizzes, cards and actions never change it. There is no "proficient", "ready" or "complete" state. | Status means what she says it means; the app never implies an instructor's judgement. |
| **M3-D3** | Attribution | Two kinds only: **"My own observation"** (`self_report`) and **"My instructor said (as I wrote it down)"** (`instructor_transcribed`), with an optional instructor name she types. **No verified-instructor state** exists in storage, the interface or restore. | Honest on a single-user local app with no identity mechanism. A verified kind would need a separately scoped, reviewed mechanism. |
| **M3-D4** | Creating observations | Only deliberately, one at a time, against a debrief she picked. She may say which debrief field it came from (its text is fingerprinted, never copied). There is **no automatic backfill, AI extraction or creation from quiz or action results**. Limits: wording 1–2,000 characters (≤ 8,000 bytes); 50 per debrief. | Existing debriefs stay valid and usable. Nothing appears that she did not record. |
| **M3-D5** | Edits and history | Every change appends a history entry: wording, date, attribution, name, link and addressed state. Earlier versions are always visible, back to the first wording (read in pages of at most 100). The **skill and source debrief are fixed** after creation; to move one, erase it and record it again. An edit based on an old version is refused, and she is asked to reload. | History is intelligible and nothing is silently rewritten or relinked. |
| **M3-D6** | When sources change | **Deleting a debrief keeps its observations** with a snapshot of the debrief's title and date, shown as "from a debrief that was deleted". They are never re-attached to another debrief. A renamed debrief shows its new and recorded names; an edited source field shows "edited since you recorded this". **Deleting a linked action** keeps its name in the observation. **Skills are never deleted**, only retired (hidden from the picker, history kept, restorable). | Matches the accepted split-lineage (SL-D5) and question-provenance behaviour. Deleting a lesson never quietly destroys feedback history. |
| **M3-D7** | Erasure and retention | Kept until she chooses otherwise; nothing expires automatically. **Erase permanently** works on one observation, with explicit confirmation. It removes its wording and every history entry. Only non-content tombstones remain (ids, request hash, time), so a late retry can never bring it back. Erasing does not touch the debrief. Backups made earlier still contain the observation, and the confirmation says so. | A clear, bounded privacy control, separate from deleting a lesson. Needs owner approval because it sets retention policy. |
| **M3-D8** | Follow-up actions and "addressed" | She can link one existing action, and later unlink it. **"Mark addressed"** is her own explicit choice, recorded in history. **Completing the action never marks the feedback addressed.** The page says so: "Finishing it doesn't mean this was resolved in flight." Repeating the same request replays it; a conflicting one is refused. | Keeps "I did the homework" separate from "the problem is solved in the airplane". |
| **M3-D9** | Confidence and wording boundaries | An optional **1–5 confidence per skill**, with history, separate from status and from the per-lesson debrief confidence (unchanged). Evidence is described in words, never as a score: "No observations yet", "Only a few observations so far: not enough to show a pattern" (fewer than 3, or all from one lesson), or "N observations from M lessons". Every skill page carries "This is your own record. It isn't an instructor sign-off or a proficiency rating." | Small samples read as insufficient, and no percentage or readiness claim appears. |

Ordinary implementation choices (ids, indexes, page sizes, error wording) are the implementer's judgement. Only the nine rows above need the owner.

## Authorized execution

Execute the [active model-neutral production assignment](M3_SKILLS_EVIDENCE_PRODUCTION_START_PROMPT_2026-10-11.md) in one isolated worktree from then-current origin/main. Deliver the complete native/TypeScript/UI vertical slice with reviewed schema registration, genuine populated upgrade and restore proofs, meaningful failure/retry tests and final source gates. Leave changes uncommitted and unpushed for independent review.

Do not request the same default approval or restart settled prototype preparation. Preserve the dirty primary, M3 preparation and parallel M4 worktrees. Ordinary implementation choices remain within the approved scope. The approval does not activate M4, installed tests, provider calls, signing or release; G1–G3 remain deferred/unexecuted/unverified.
