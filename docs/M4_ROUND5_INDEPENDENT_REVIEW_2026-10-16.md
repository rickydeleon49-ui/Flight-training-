# M4 round 5 and release record: independent review — 16 October 2026

## Decision

**M4: corrections required before acceptance.** The round-5 submission fixes the prior reproduced exception/future-token/install-record/name-filter cases, and its full runner passes independently on both Node lanes. Two remaining ownership boundaries fail new diagnostics. A separate receipt-accuracy issue is non-blocking but small enough to correct in the same pass. This is an evidence-only prototype; no production M4 code, dependency adoption or migration0015 is approved here.

**RELREC-01 / PR #178: accepted and merged** at `2f4cca2feda8a983e9d9e59d25fadb5656abc5b0`, after successful exact-head CI38952463917 on `2d6c432c8ba1b352d3a9d9dbb8600a1e03e666d1`, with current main and CLEAN merge state. All six JPGs are tracked, linked, visually inspected and consistent with synthetic/sample data; no key value is shown. The21-entry release-report/evidence inventory is complete, all earlier raw receipts and the separate6-artifact manifest match the reviewed prior head, the21 current helper checksums verify, and26 helper tests plus diff hygiene pass. This accepts the existing evidence publication; no new installed run or provider request was made. The original release record's request for retrospective #176/#177 review is historical; the bounded review already exists in `M4_RELEASE_INDEPENDENT_REVIEW_2026-10-16.md`.

## Frozen input and independent replay

Submission: `/Users/rickymac/code/Flight-training-m4-round4`, branch `claude/m4-round4-corrections`, HEAD `7e495580a48828c2c81cc4d8057e028acfc2a8eb`, uncommitted M4 documents only. The reviewer froze594 M4 input files before running anything and verified the144 delivery,141 payload and81 round-5 supporting checksums. All594 remain unchanged after review. A20-file exact specimen of the candidate/proof/runner sources and engine manifests is published under the review evidence; the14 migration references were extracted by the accepted-main preparation at pinned `e8720003a76be680812dfe3605d58e7eb6372d00` and are separately inventoried. The specimen is for reproducing findings, not adoption or a replacement full delivery pack.

All execution occurred in disposable clones. Node22.23.3 used a captured live npm10.9.9 engine install. The Node26.10.0 clone first captured its own genuine npm10 install with Node22, then reused it on Node26. The independent test subprocess environment used npm10 for both lanes; it does not claim a successful npm12 install. The submission's npm12 EUSAGE failure remains preserved and separately classified.

| Check | Node22 | Node26 |
| --- | --- | --- |
| Original four diagnostics on the round-4 reviewed specimens |0 passed /4 failed, exit1|0/4, exit1|
| Frozen earlier five on round-4 specimens |5/5, exit0|5/5, exit0|
| Complete round-5 runner |exit0,25 steps|exit0,23 steps|
| Permanent suites |proof80 + lifecycle10 + sensitivity3|80 +10 +3|
| Mapped tests / executed mutants |93 /20|93 /20|
| Prior four diagnostics on corrected source |4/4, exit0|4/4, exit0|
| Frozen earlier five through disclosed seed adapter |5/5, exit0|5/5, exit0|
| New ownership diagnostics |0/4, exit1|0/4, exit1|
| New real-runner signal diagnostic |0/1, exit1|0/1, exit1|

The actual Node26 full runner also rejects both preserved false-positive probes: a failed install record (`exit:42`) and an appended active invented mutant claim. Both exit1 with the expected failed receipt. The frozen-five adapter only initializes the unreserved R29 seed through the real reservation API; no frozen ordering/expectation was edited. Its direct4/5 result is disclosed by the implementer and is not labelled a pass.

## Findings

### M4-R37 — P1: reservation failure leaves an obsolete operation live

Location: `proof/openerController.mjs:61–132`, especially the failure returns at93/101/108 before `currentIntentId` and `activeOperation` advance.

Reproduction: save page5, start operation A to page10 and hold either its opener or its persistence callback before the actual write. Install a claims UPDATE trigger that raises ABORT. Start operation B to page20: its reservation fails and B reports failure. Release A. On both Node versions, A still reports success, the controller changes from `failed` to `opened`, and the saved page becomes10. The failed newer intent never invalidated A. The new isolated R33 test only checks a fresh controller with no prior request, so it misses this continuation.

Required fix: establish request-local supersession synchronously at entry, before ownership reads/reservation can throw or return; invalidate the old operation's callbacks and live cancellation flag independently of acquiring a new durable token. Keep local request epochs separate from database generations. Guard preliminary ownership reads as well as reservation callbacks. A failed new reservation must not mint a token, open/save the new destination, or let an older held opener/save/retry publish or persist later. Preserve the existing in-transaction cancellation fence and immutable tuple; no compensating page rewrite.

### M4-R38 — P2: successful SQL execution is mistaken for a durable claim

Location: `proof/persistenceProtocol.mjs:97–106`.

The UPSERT result is discarded, and no claim postcondition is checked before returning `nextGen`. A BEFORE INSERT or UPDATE trigger using `RAISE(IGNORE)` succeeds without writing the claim. Two reservations return `[2,2]`: the INSERT case has no claim row; the UPDATE case still has reserved_generation1. Both Node versions reproduce this. R34 correctly refuses those unreserved commits, so this finding does not claim the old incorrect-winner write still succeeds. It does violate R33's promise that ownership is durable before a token is issued, and lets the opener proceed with false ownership.

Required fix: under the same write transaction, require the claim mutation to take effect and verify the exact expected persisted claim before COMMIT/return. Treat zero-row/missing/wrong-generation postconditions as reservation failures, roll back, and throw. Do not simply replace the exception catch: these statements throw no SQLite error. Cover ignored INSERT and UPDATE plus a successful reservation control; ensure a post-write read failure/wrong row also fails closed. The stored page/hash/label/status and prior claim must stay unchanged on refusal.

### M4-R39 — P2, non-blocking: install termination signal is lost

Location: `scripts/run_integration_proof.mjs:145–155` and `:241`.

The exec wrapper drops `spawnSync().signal`, and the live install record always receives `signal:null`. In a disposable test adapter, npm's version command succeeds and the install child terminates itself with SIGTERM. A control confirms SIGTERM; the real runner exits1 correctly, but its execution record has both `exit:null` and `signal:null`. Both Node lanes reproduce this. Failure refusal is intact; the inaccurate receipt is the issue.

Required fix: carry the actual child signal (and existing spawn error) through the exec record into the install execution record/audit. Never invent a numeric exit code for signal termination. Retain the failed summary and NOT RUN/incomplete verification behavior. Add the real-runner SIGTERM regression using only a disposable npm adapter; no production PATH/environment bypass is required.

## Limits and handoff

[One correction assignment](M4_ROUND5_CORRECTIONS_PROMPT_2026-10-16.md) covers R37–R39. R34's exact reserved-token check, R35's integrity-vs-execution-record check and R36's precise claim parsing are retained; do not restart them or weaken93 existing mapped tests/20 mutants. M4 remains uncommitted and unaccepted. OD-1–OD-10 remain proposed, P54-01 and production migration0015 remain unstarted, and the eight-item roadmap order stays unchanged. OPENFOLDER-01 remains a separate bounded maintenance follow-up.

No reviewer application build, desktop launch, profile/account operation, key access, provider call, signing or release publication occurred. PR #178 acceptance does not extend installed-test coverage or resolve unverified signing, standard-account, VoiceOver or minimum-OS gates.

Evidence: `docs/evidence/m4-round5-independent-review-2026-10-16/`. It includes raw success/failure receipts, frozen runnable diagnostics, submitted source hashes, specimen hashes and the PR178 gate/merge receipts. Reviewer scratch installs/clones are removed only after preserving the receipts.
