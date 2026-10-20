**P2 — Committed Gemini saves with normalized pages are not recognized on retry.** [documentRepository.ts:409](/Users/rickymac/code/Flight-training-offline-03a-fixes/src/data/repositories/documentRepository.ts:409) stores `sourcePage: 1001` as `null`, but [GeminiJobs.tsx:237](/Users/rickymac/code/Flight-training-offline-03a-fixes/src/state/GeminiJobs.tsx:237) compares the saved cards against the raw answer.

Reproduced: the save commits, its response is lost, and **Save again** incorrectly reports “Something newer was saved.” After restart, the same committed answer remains an unrecognized checkpoint.

**Fix:** apply the shared `generatedPage` normalization before `alreadySaved` compares generated cards. Add regressions for response loss after commit and journal recovery after restart. Both diagnostics pass with that comparator correction applied in memory.

Both round-2 fixes pass. All 146 focused tests, typecheck, receipt checksums and diff checks pass. Unchanged native receipts remain applicable. Repository files were unchanged; exact-head CI remains unverified.

VERDICT: RED

