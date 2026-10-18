# Finish M4 ownership failure boundaries — model-neutral assignment

You are the implementing agent. Codex reviewed round5; the normal runner passes on both lanes, but independent diagnostics reproduce two ownership gaps. Complete this bounded correction pass, then stop for review. PR #178 RELREC-01 is already accepted/merged at2f4cca2; do not redo it, its screenshots, its installed tests or its release.

## Start and preserve

- Worktree: `/Users/rickymac/code/Flight-training-m4-round4`; branch `claude/m4-round4-corrections`; submitted HEAD `7e495580a48828c2c81cc4d8057e028acfc2a8eb`. The M4 submission is intentionally uncommitted. Do not pull, reset, stash, clean or overwrite it.
- Fetch first. Read `docs/M4_ROUND5_INDEPENDENT_REVIEW_2026-10-16.md` and this complete assignment from `origin/main` with `git show` when absent locally. Read latest STATUS/handoff and your round5 report. Do not confuse earlier pending historical entries with the newest review.
- Before editing, verify every path in `docs/evidence/m4-round5-independent-review-2026-10-16/submitted-all-hashes.json` against this worktree:594 input files. If anything differs, identify it and preserve competing work before proceeding. Verify submitted144 delivery,141 payload and81 supporting checksums.
- Archive round5 receipts/manifests/report/map as immutable historical evidence before regenerating any. Keep Gemini's original checkout and all previous failed/npm12 receipts untouched. No native build, app launch, profile/key access, provider request, dependency adoption or migration registration is needed.

Current pack: `docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/`. Frozen new diagnostics and exact source specimens are in the independent review evidence folder. Use `M4_REVIEW_TARGET_PACK` to target your real pack; prepare the accepted-main reference first as below. The new diagnostics default to the reviewer specimen if no target is supplied.

## R37 — retire old work before a new reservation can fail

Edit `proof/openerController.mjs` deliberately. Its early ownership/reservation failures currently return before currentIntentId/current route/activeOperation change. The superseded callback still passes its ownership checks.

Exact failing sequence: seed saved page5; begin A for page10; hold A in the opener, or hold its persistence callback before the actual protocol write; make claim UPDATE raise ABORT; begin B for page20; B fails reservation; release A. Current observed result is A.success=true, controller.state='opened', saved page10. Required result is A superseded/unsuccessful, the newest failure remains published, saved tuple remains page5 with its original hash/label/status, and no obsolete callback/retry advances progress.

Establish a local request/route epoch synchronously at function entry, before generationSource/identityProvider/ownership reads/reservations can throw. Invalidate previous active work/cancellation state without relying on a successful new database reservation. Do not confuse a local epoch with a durable operation token or fabricate a token when reservation fails. Guard all ownership-acquisition error/overflow paths coherently. Preserve cancellation inside commit and the original immutable page/hash/label tuple.

Promote BOTH held-boundary diagnostics. Add the save-only retry case and a thrown preliminary identity/generation read. Verify no second opener invocation, no compensating persistence write, no late success/failure overwriting the newest route, and an exact retained saved tuple. Preserve legitimate successful newer requests, cross-controller ordering, abort/dispose, content identity and all previous R13/R28–R30 behavior.

## R38 — prove the claim exists before issuing its token

Edit `proof/persistenceProtocol.mjs` reservation at the UPSERT. It currently ignores the statement result and returns nextGen after any non-throwing COMMIT.

The frozen diagnostics use BEFORE INSERT / BEFORE UPDATE `RAISE(IGNORE)` triggers. Two calls currently return tokens[2,2] while the claim is absent (INSERT) or still reserved_generation1 (UPDATE). These do not throw; an exception-only fix cannot detect them. R34 already refuses the resulting unreserved writes and must remain intact.

Within the same BEGIN IMMEDIATE transaction, require the claim write to take effect and validate the exact persisted claim postcondition before committing/returning. Throw and roll back on a zero-row write, missing/wrong-generation row or post-write read failure. Preserve prior claim and reading tuple on refusal. Add meaningful ignored INSERT/UPDATE tests, a post-write wrong-row/read-error test and a normal durable-success control; keep two-connection/restart/overflow coverage. Do not restore on-demand claims-table creation or tolerate best-effort writes.

## R39 — keep the real signal in the install receipt

The runner exec wrapper discards spawnSync.signal and install execution construction hard-codes null. Propagate the actual signal and existing spawn error through the execution record/audit. A signalled child must keep exit:null and signal:'SIGTERM' (or the actual signal), fail the run and leave no successful verification claim. Do not invent exit1 as if npm exited normally.

Promote the reviewer real-runner signal diagnostic. Its fake npm belongs ONLY to the disposable test fixture: --version succeeds; the install child terminates itself. Keep the control proving its signal and assert the runner's saved record agrees. No test-only bypass belongs in the distributed runner/protocol.

## Verification and evidence

First reproduce the frozen five new assertions on reviewed specimens, then your starting pack: four ownership assertions and one signal assertion fail on each Node lane. Preserve these receipts. After correction, all five must pass unchanged against the real pack. The additional-diagnostics file uses the14 shipped migration definitions; prepare them in scratch with the existing accepted-main script, or point the specimen at the separately inventoried review references.

Run from a disposable clone, with the submitted documents/pack copied in:

```sh
NODE22=/opt/homebrew/opt/node@22/bin/node
PACK=docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11
"$NODE22" "$PACK/scripts/prepare-accepted-main.mjs" e8720003a76be680812dfe3605d58e7eb6372d00
M4_REVIEW_TARGET_PACK="$PWD/$PACK" "$NODE22" --test /path/to/review-evidence/additional-diagnostics.test.mjs /path/to/review-evidence/signal-diagnostic.test.mjs
```

Use the exact frozen files read from origin/main; replace only their external location in the command. Preserve their bytes, ordering and expectations. Run the previous four diagnostics unchanged and the earlier frozen five via the already disclosed R29 fixture-seeding adapter. Do not claim the unadapted4/5 as passing or widen the adapter into production.

Then run complete runners sequentially in TWO fresh disposable copies:

1. Node22.23.3 with PATH selecting npm10.9.9 and a captured live --install.
2. Node26.10.0 reusing a genuine captured npm10 install in that SAME clone. Capture it with Node22 --engine-check-only --install, then run the Node26 full runner without --install. Keep integrity and execution attestation distinct. The existing npm12 failure remains a failure; no lockfile edits or manufactured zero-exit metadata.

Retain all93 prior mapped tests and20 mutants. Legitimate fixture setup changes cannot weaken their behavioral assertions. Add meaningful regressions/guard-reversion mutants for new guards; derive final counts from real executions. Re-run the actual full-runner failed-record and active invented-mutant probes and the new signal test. Keep interrupted/outcome and two-stage manifest checks intact. No application/Rust matrix or unrelated dependency reinstall is required for this evidence-only assignment.

Deliver a new correction report, R37–R39-to-exact-test/mutant map, complete raw commands/exits, two full lane receipts, preserved historical failures and accurate final manifests/source hashes. Preserve round5 evidence rather than rewriting its measured results. Update current STATUS/handoff/roadmap without deleting history or implying OD approval. Freeze final bytes, verify every checksum and remove only your own disposable clones/dependencies after receipts are saved.

Leave the M4 package UNCOMMITTED and UNPUSHED in its existing worktree for Codex. Do not merge, publish, build a release, start P54-01 production adoption or register migration0015. Stop with a concise completion message identifying exact files, passing and failed outcomes, final hashes and any remaining limitation.
