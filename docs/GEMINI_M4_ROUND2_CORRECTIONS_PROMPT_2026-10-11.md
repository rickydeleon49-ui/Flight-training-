# Gemini: M4 round-2 integration corrections R13–R22

**Superseded** by [round 3](GEMINI_M4_ROUND3_CORRECTIONS_PROMPT_2026-10-11.md) after [review](M4_ROUND2_CORRECTIONS_REVIEW_2026-10-11.md). Originally ACTIVE, 11 October 2026. Owner assignment: Gemini implements; Claude reviews while Codex is unavailable (see [reviewer switch](REVIEWER_SWITCH_AND_PR_REVIEW_2026-10-11.md)). This is a wrapper around the existing model-neutral assignment. It adds who does what and where the work currently stands. It changes no requirement.

## Read first, in this order

1. [`M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_REREVIEW_R2_2026-10-11.md`](M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_REREVIEW_R2_2026-10-11.md): the findings, in full.
2. [`M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_R2_PROMPT_2026-10-11.md`](M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_R2_PROMPT_2026-10-11.md): **the requirements.** R13–R22, regression criteria, boundaries and stop point all come from that document. Where this wrapper and that prompt disagree, the prompt wins.

Your worktree is behind `origin/main`, so read both from Git without pulling:

```bash
git -C /Users/rickymac/code/Flight-training-m4-viewer-evaluation fetch origin
git -C /Users/rickymac/code/Flight-training-m4-viewer-evaluation show origin/main:docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_REREVIEW_R2_2026-10-11.md
git -C /Users/rickymac/code/Flight-training-m4-viewer-evaluation show origin/main:docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_R2_PROMPT_2026-10-11.md
```

## Where the work stands (observed by the reviewer, read-only)

- Worktree `/Users/rickymac/code/Flight-training-m4-viewer-evaluation`, branch `codex/m4-navigation-viewer-evaluation`, HEAD `c28ab8482c8635b0b2bf74686b081e02bf448f65`, behind `origin/main` (`bf5cf59` at the time of writing). 18 untracked entries, no tracked modifications.
- **A round-2 pack has already been started and not finished.** `docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/` holds 71 files outside `node_modules`, written 11 October 15:11–15:37. It includes `proof/`, `candidate/`, `fixtures/`, `receipts/00-pre-edit-inventory.json`, `receipts/01-accepted-main.json`, `proof/shippedLedger.mjs`, `scripts/parser-entrypoint.mjs`, `scripts/record-scratch-artifacts.mjs`, `scripts/run_integration_proof.mjs` and an installed `scratch/pdfjs-engine/`. No round-2 correction report exists yet.
- The R9–R12 pack (`…integration-corrections-2026-10-11/`) and its report are the previous round's deliverable. They are frozen.

**Start by inventorying the started round-2 pack.** For each R13–R22 item, record whether that pack already addresses it, partly addresses it or doesn't touch it. Continue from it rather than starting over. Don't delete or overwrite it blindly, and report anything in it you can't explain. If you decide a file must be replaced, say which one and why.

## Environment

- Project lane: `PATH=/opt/homebrew/opt/node@22/bin:$PATH` (Node 22.23.3).
- Second lane: `/opt/homebrew/bin/node` (Node 26.10.0).
- Run both lanes **sequentially**, never in parallel. Don't change shell configuration.
- Run no whole-app matrix. Run only the focused suites, sensitivity mutants, compatibility probe, parser step and the runner's own integrity gate, as the prompt specifies.

## Hard boundaries (restated from the prompt)

- Evidence-only. Don't touch production source, dependencies, `src-tauri/migrations/`, the migration registry or the backup format. Candidate 0015 stays provisional and unregistered.
- Don't edit `ROADMAP.md`, `STATUS.md` or `docs/PROJECT_HANDOFF.md`. Put proposed tracking entries in your report.
- Don't touch the primary checkout (`/Users/rickymac/code/Flight-training-`, which has someone else's uncommitted changes), the M3 worktrees, the other `Flight-training-*` worktrees or the frozen rereview pack.
- Don't pull, reset, stash, clean, commit or push. Leave everything uncommitted.
- No real user data, installed run, test-account work, rebuild, signing, release or provider call. G1–G3 stay deferred.
- Gemini's standing security brief does not widen this scope. If you notice a security issue outside R13–R22, list it in the report as an observation; don't fix it.

## Deliver, then stop

The deliverables are exactly those in the prompt's "Boundaries and stop" section:

- the round-2 correction report
- the rewritten conditional implementation prompt (`Durable Commit Fencing` moves to the commit-time contract)
- the updated evaluation document and issue/test map
- the new evidence pack, whose `SHA256SUMS` must pass `shasum -a 256 -c` against its own delivered bytes
- exact commands, runtimes, exit codes and counts for both lanes
- proposed tracking entries

Then reply in chat with:

1. a table: R13–R22 → status (closed / partial / blocked) → test name(s) → mutant name(s)
2. both lanes' suite counts and exit codes, and the runner's integrity-gate result
3. what you found in the started round-2 pack and what you kept or replaced
4. every claim you corrected or withdrew (including "32 of 32" and "older-binary refusal verified")
5. any blocker or open question

Don't start M4 production and don't ask the owner to approve OD-1–OD-10. Claude reviews next.
