**P2 — Regeneration review hides the content she must judge.** [RegenerationReviewDialog.tsx:191](/Users/rickymac/code/Flight-training-offline-03a-fixes/src/pages/StudyLibrary/RegenerationReviewDialog.tsx:191) renders only `describe(entry)`: a card’s question, a section’s heading, or “Summary.” Answers, section bodies, summary text and matched retired text are absent.

Reproduced with a near-repeat of a corrected card: **Keep it** is offered without displaying the proposed answer. She therefore cannot judge whether it would reintroduce the wrong answer beside her correction. The same omission affects **Bring it back** and new items.

**Fix:** display each candidate’s complete content and, for near matches, the corresponding retired content from history. Add UI regressions asserting these texts are visible before choosing.

Verification at `9cbc376`: the round-3 fix passes both regressions; all 179 focused tests, typecheck and receipt checksums pass. An additional in-memory UI diagnostic confirms the three missing-content cases. Unchanged native receipts were reused. Schema-helper rerun was sandbox-blocked; exact-head CI remains unverified. Repository files were unchanged.

VERDICT: RED