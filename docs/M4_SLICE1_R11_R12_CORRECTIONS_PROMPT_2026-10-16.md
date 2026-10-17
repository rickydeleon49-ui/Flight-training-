# M4 Slice1: finish R11–R12 lifecycle fixes

Continue the existing PR189 implementation, not a new feature. Codex remains independent reviewer; do not merge. All owner OD-1–OD-10 approvals persist. Work through both fixes and final verification without routine permission pauses.

Read current origin/main `docs/M4_SLICE1_R11_R12_REVIEW_2026-10-16.md`, the frozen evidence README/diagnostics and latest roadmap/status/handoff. R5–R10 original failure sequences have corrections; retain them. The new source review has3 failing cases for2 remaining lifecycle defects, plus a passing control.

## Preserve the active work

Worktree `/Users/rickymac/code/Flight-training-m4-slice1`; branch `claude/m4-slice1`; PR https://github.com/rickydeleon49-ui/Flight-training-/pull/189 . Published reviewed head c234005185250f14b2f67bf5d977a5b67b853126;93 committed submitted paths frozen in the review evidence. Claude may already be making newer terminal changes. Fetch and inspect actual branch/status first; compare any newer committed/uncommitted changes to the review before editing. Do not overwrite, reset, stash or clean them, and do not start competing fixes in another worktree. The frozen manifest identifies published input, not an instruction to revert ongoing work.

Read missing review docs from origin/main without pulling over a dirty checkout. Merge current main when safe, preserving source, both tracker histories and the correct feature helper bindings. Leave primary settings, other worktrees, profiles and installers alone. Scope remains source tests only.

## Reproduce and fix R11

Use `frozen-retired-followup.test.ts` beside the navigation hook in a disposable matching copy, or promote its cases to the existing hook test suite. On the published head both variants fail: old checkPages/deleteBookmark completion publishes old repository A over current B.

Bind the initiating action's material/repository/lifetime context across its awaited inspect/mutation and its finally/reload. An old closure must not be allowed to allocate a new latest-read id after its context retires. Prevent the stale read dispatch itself, and protect current state/error/loading/read ownership. Keep ordinary same-context post-mutation refresh working even when other valid reads overlap.

Permanent acceptance matrix:
- Held checkPages completes after a repository change: B remains visible, no retired-repository read starts.
- Held mutation completes after repository or material change: current context remains intact.
- Old upstream success and old upstream rejection both leave the new state/error/loading unchanged.
- Cover setRead, addBookmark and deleteBookmark follow-ups, not only one method with analogous unguarded copies left behind.
- Hold a current-context read while old work finishes; old work must not invalidate that read or clear its loading indicator.
- Unmount/StrictMode cleanup/setup retires appropriate lifetime work while the live hook remains usable.
- Same-context successful writes still reload current data and preserve existing CAS/native guards.

Use deterministic deferred gates and observable dispatch/state assertions. Do not fix this merely by keying a parent route component; the same mounted hook can change repositories.

## Reproduce and fix R12

Use `frozen-badge-ownership.test.ts` beside SourcePageBadge in a disposable matching copy. Its control (one held request followed by unmount) passes; the overlapping-request case fails because an older null completion clears a newer request's ref.

Give each click a stable ownership marker and compare that marker before clearing/updating cleanup ownership. Include controller identity plus epoch or a unique local ticket; epoch alone is not globally unique across controller instances. Keep the currently owned marker available to unmount cleanup. Do not cancel a request owned by another badge or newer intent.

Permanent acceptance matrix:
- Request1 retired; request2 starts; request1 resolves null; unmount; release request2: no open.
- Repeat with older error/success completion and with the current request still inspecting.
- Replace controller/repository while an old request is held; a late completion on the old controller cannot clear the new controller's request even if epochs coincide.
- Ordinary guidance succeeds, writes no reading state/claim, and still checks file identity.
- Single-request unmount control remains green; no already-dispatched OS open is claimed to be undone.

## Evidence and finish

Preserve the frozen failing receipts and earlier passing source gates. Add only meaningful new regressions; do not duplicate copied controls unnecessarily or weaken expectations. The old guidance-control selector adaptation is documented in the review and is unrelated to these production defects.

Keep the implementation checkpoint current with exact HEAD, dirty/staged/untracked state, findings closed/open, raw exits and next action. Continue both groups to completion while useful authorized work remains. If usage ends, leave a recoverable checkpoint; if finished, stop for review rather than starting unrelated tasks.

Run focused tests first, then the normal final sequential application gate on Node22 and scoped SDK26.5 as required: typecheck; full npm test; web build; locked Rust tests; all-target Clippy with warnings denied; fmt; cargo-lock; schema14 helper tests; submitted diff hygiene. Do not repeatedly rerun broad gates on identical source or suppress failures. Keep original failed receipts separate from corrected final results.

Update ROADMAP/STATUS/PROJECT_HANDOFF preserving history. Publish a concise R11/R12 issue-to-test map, source hashes and complete evidence manifest. Refresh only affected current helper bindings. Update existing PR189 and require green CI on the exact final head before handing back to Codex. Do not self-merge.

No new dependency, schema/version change, provider call, profile/key operation, app launch, installer build, signing or release publication is authorized by this assignment.
