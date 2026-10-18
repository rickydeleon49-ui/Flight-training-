# Independent calendar review and correction evidence

Original Gemini submission ce3c948:8 source hashes and23 original evidence checksums verified from Git blobs. Original raw receipts remain byte-identical. `baseline-diagnostics.txt` records six independent failing counterexamples (exit1); `frozen-diagnostics.ts` is that exact diagnostic, copied beside calendarExport.ts when executed and removed afterward. `frozen-on-fix` passes6/6; the permanent boundary suite expands these to11 cases, including a complete independently specified ICS fixture and valid limits.

Independent corrected-source checks: focused81/81; formatter/boundary31/31 in each of UTC, America/Los_Angeles and Pacific/Kiritimati; production build/typecheck; native export15/15; all-target Clippy with warnings denied; fmt; helper26/26. Each executed stage has raw text and exit status. `gate.json` records the sequential timezone/build/native/lint/fmt commands. Full author frontend3,629/6 skipped and native533/6 ignored receipts are reused for unchanged areas rather than repeated independently.

Git diff hygiene on ce3c948 initially fails on raw-log trailing whitespace/blank EOF; three current tracker source bindings also mismatch. Exact-path attributes preserve those logs as raw evidence, and only current tracker bindings/checksums are refreshed. The source-hash file records current application/test bytes; final evidence/helper checksum members are verified from Git index blobs before publication.

No app launch, actual Calendar import, NSSavePanel interaction, real profile/key/provider, installer, signing, version or release work. These remain source-level checks. No merge authorized; Codex's own formatter correction still needs independent review.
