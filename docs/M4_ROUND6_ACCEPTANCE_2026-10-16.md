# M4 round6 prototype: independent acceptance — 16 October 2026

**ACCEPT the evidence-only package for integration**, effective when the containing PR passes exact-head CI and merges. R37–R39 are closed in this prototype. No new blocking defect found in the assigned corrections. This accepts the reference design and measured evidence, not a production feature, installed behavior, dependency adoption or owner scope decision.

## Independent source review and execution

The original worktree remains at7e49558 with its submitted changes untouched. Before execution,709 submitted files were frozen;172 delivery,169 payload and78 round6 supporting checksum entries verified. No M4 source collision exists with current main. All source/proof/candidate/evidence imports are byte-identical to the submission. Only the three old tracker prefixes are reconciled with current history; the five submitted tracker/helper files are archived in `submitted-root/` rather than overwriting current main.

Both independent replays ran from disposable clones of accepted main996b8ac, with the M4 overlay and accepted-main schema reference e8720003. The14 shipped migration bytes/checksums remain unchanged, candidate0015 remains unregistered, and no production source changes are integrated by this package.

| Evidence | Node22.23.3 | Node26.10.0 |
| --- | --- | --- |
| Full runner |exit0,25 steps|exit0,23 steps|
| Suites |proof91 / lifecycle10 / sensitivity3|91 /10 /3|
| Mapped tests / executed mutants |104 /24|104 /24|
| Frozen assigned R37–R39 diagnostics |5/5 pass|5/5 pass|
| Previous four diagnostics |4/4 pass|4/4 pass|
| Earlier frozen five through disclosed seed adapter |5/5 pass|5/5 pass|
| Earlier frozen five directly, without adapter |4/5, exit1 — preserved, not a pass|4/5, exit1 — preserved, not a pass|
| Assigned diagnostics on the prior reviewed specimens |0/5, exit1 — expected reproduction|0/5, exit1 — expected reproduction|

The93 prior mapped test names are retained, plus11 additions. All24 guard-reversion mutants executed and failed their regressions. M13/M17's retargeting reflects newly overlapping fences; original regressions still execute. M16's pattern follows the refactored ownership helper. Actual full-runner negative probes reject exit42, an active invented mutant claim, and a recorded termination signal, each exit1 with a failed receipt.

Node22 performed a real captured npm10.9.9 installation. The Node26 clone first captured its own real npm10 install using Node22, then reused it with both integrity and execution attestation passing. The independent subprocess PATH used npm10 in both lanes. This does not claim npm12 installation succeeded; its original EUSAGE failure is preserved in the submitted evidence.

## Why the fixes close the findings

- **R37:** requestEpoch advances and the prior active operation is retired before fallible ownership reads/reservation. The shared ownership helper checks epoch, active operation, immutable intent, material and cancellation. Held opener/save continuations and save-only retry no longer publish or persist after the newer reservation fails. Preliminary read failures are reported. Tests check exact saved tuples and a legitimate later success.
- **R38:** the UPSERT must affect exactly one row, and the same transaction must read back exactly the reserved token. Ignored INSERT/UPDATE, wrong-generation postconditions and read-back failures roll back and issue no token. The successful control, restart, cross-connection and overflow tests remain intact.
- **R39:** exec carries the actual signal/error into install execution records and audits; a killed child retains exit:null and its real SIGTERM. The run fails without a fabricated exit or successful verification. Signal-bearing records cannot attest reuse. Test adapters are confined to disposable copies.

## Integration and document reconciliation

The old conditional implementation draft and evaluation text are preserved as historical submission bytes. They contain stale implementation details (three tables instead of the current four, non-null hashes, and weaker generation examples). The new [current production handoff](M4_SLICE1_CURRENT_HANDOFF_2026-10-16.md) supersedes those implementation instructions; do not port those old literal examples.

One owner-scope discrepancy is explicitly surfaced: original OD-6 proposes clamping out-of-range coordinates, while the measured reference resolver refuses them. The [decision packet](M4_PRODUCTION_SCOPE_DECISIONS_2026-10-16.md) recommends refusal with a clear message, preserving the tested behavior. No owner decision is inferred from accepting the prototype.

The author final-hashes file is a receipt of the original submission, including its old tracker bytes. It remains unchanged. `submitted-final-hashes-rebased.txt` verifies that same receipt against the archived tracker/helper aliases and current byte-identical M4 files. The acceptance SHA256SUMS binds the actual integrated files and current trackers. This keeps historical receipts and current identity distinct.

## Next work and limits

No more prototype correction round is assigned. Owner dispositions of OD-1–OD-10 are needed before production Slice1; all remain proposed. Once approved, implement real source links, bookmarks and last-requested tracking with the native reader baseline, using the current handoff and the104-case reference. P54-01 implementation and production migration0015 remain unstarted. Embedded rendering remains a later evaluation; no PDF.js/React-PDF package is adopted by this acceptance.

The prototype's synchronous Node SQLite transaction and live JavaScript cancellation predicate are reference mechanisms. Production must prove equivalent Rust/browser ownership and cancellation across asynchronous command boundaries; functions cannot be serialized through Tauri. Include cross-material/content failure-route tests and honest native-open guidance in that port. A successful OS open request is not proof that Preview displayed a requested physical page or that the learner read it.

No application/Rust matrix, native build, desktop launch, profile/account/key operation, provider call, signing or publication was needed or executed for this evidence-only review. Installed Mac/minimum-OS/VoiceOver, paid-generation and release waivers retain their existing status. Reviewer scratch clones/dependencies are removed only after raw receipts are preserved. The eight-item roadmap order and separate OPENFOLDER-01 task remain unchanged.
