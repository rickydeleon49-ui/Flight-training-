# Finish PR189: M4 Slice1 R5–R10 — model-neutral assignment

## Goal and authorization

Correct the six independent review findings in the existing M4 feature PR, preserving the completed implementation and prior useful fixes. Work through the complete assignment autonomously while useful authorized work remains. Do not stop for approval between routine stages. All ten owner scope decisions, including OD-6 refuse-and-explain, remain approved. Codex reviews before integration; do not self-merge.

Read current origin/main documents first:
- `docs/M4_SLICE1_REREVIEW_2026-10-16.md`
- This assignment and its frozen evidence README/diagnostics.
- `docs/M4_PRODUCTION_SCOPE_OWNER_APPROVAL_2026-10-16.md`
- The current M4 handoff and latest STATUS/ROADMAP/PROJECT_HANDOFF.

Then read the actual feature report/checkpoint and the existing R1–R4 implementation. This task supersedes the older “finish the partial checkpoint” task: the full feature now exists. Do not rebuild it, reopen approved scope questions, or restart the prototype.

## Establish identity and preserve work

Worktree `/Users/rickymac/code/Flight-training-m4-slice1`; branch `claude/m4-slice1`; PR https://github.com/rickydeleon49-ui/Flight-training-/pull/189 .

Reviewed head: **6d8c6080426d99e73399eb447412e09426b72bba**. It was clean. All66 submitted files are frozen in `docs/evidence/m4-slice1-r5-r10-review-2026-10-16/submitted-snapshot.json`; all45 entries in the author manifest matched.

Fetch first. Compare actual HEAD/status and verify the frozen66 hashes before editing. If head or files differ, inspect the actual intervening changes; preserve competing work. Do not reset/stash/clean/force-push or overwrite a newer correction. Do not treat a changed branch as matching the old reviewed identity.

Merge current origin/main into the existing branch when safe so the new review/assignment is available. Preserve PR187's folder-opening correction, current review entries and every historical tracker entry. Reconcile current helper manifest bindings against the actual feature source and merged trackers; do not replace the feature's changed-source bindings with main's older source hashes.

Use this worktree only. Leave the primary clone, original prototype checkout, profiles, keys and installers alone. Preserve original failing receipts and reviewed author checkpoints. Only disposable synthetic data/PDFs are needed.

## Reproduce the failures before fixing them

Read `docs/evidence/m4-slice1-r5-r10-review-2026-10-16/README.md` for exact placement and commands.

- `frozen-ui-diagnostics.test.ts` contains9 existing UI controls and2 new failures. Its relative imports require placement beside the original DocumentPagesPanel tests.
- `frozen-hook-guidance-diagnostics.test.ts` contains2 new failures and belongs beside the navigation hook/controller.
- `frozen-native-count-diagnostic.patch` appends the native R10 test to the reviewed suite.

Run against a matching disposable source copy, retaining the raw results: TypeScript9 controls pass/4 diagnostics fail; native R10 fails with exit101. Do not weaken the assertions or replace real wiring with a simpler mock that bypasses the failure. Once permanently promoted, keep only the new regression cases rather than duplicating the9 existing controls.

The source review provides precise code locations and full sequences. Treat these as one correction round.

## R5 — bind bookmark opening to its saved content

`DocumentPagesPanel` currently passes the bookmark's page/label into a new current-file request, discarding originating_content_sha256. Inspection of replacement B then resolves the old A page against B.

Implement an explicit saved-destination intent or equivalent typed contract. Preserve the original material/hash/page/label/coordinate context through inspection and opening. Compare the saved identity to the freshly inspected file before dispatching the native open. A mismatch must refresh drifted state and explain, without opening the replacement or writing its old coordinate as active progress.

Keep explicit “Open at PDF page” behavior for a fresh user request distinct from opening an existing bookmark. Do not block every bookmark or silently clamp/remap it.

Add permanent cases for matching identity, same-page replacement, changed labels/count, held inspection, deleted file and null/unknown origin. Verify the unchanged reading tuple and absence of opener calls on refusal.

## R6 — freeze bookmark draft context

The parent currently closes over its latest identity and the dialog does not use its contentSha256 prop. A real parent refresh rebinds the still-open A draft to B.

Capture material/hash/count context at dialog creation. Preserve it for that draft. A refresh may invalidate/close it explicitly or allow submission to fail as stale with useful input preserved; it may not silently adopt replacement content.

Keep native R1 compare-and-set defenses. Test a background React refresh while the dialog remains open, same-count replacement, material change, held submission and ordinary success. Do not rely only on changing a database row without rerendering the parent, which is why the earlier test missed this.

## R7 — latest reload owns state, error and loading

`useMaterialNavigation.reload` currently publishes every completion. Add monotonic request/lifetime ownership so an older read cannot overwrite a newer result for the same material.

Gate success, error and finally/loading consistently. Cover repository/material changes, unmount and actual StrictMode replay. Include follow-up reloads from inspect, mutations and controller status. A stale error must not erase a later success; a stale finally must not clear the latest loading state. Keep the hook usable after StrictMode cleanup/setup rather than permanently flagging it unmounted.

Add deterministic held-success and held-error tests plus lifecycle controls. Keyed route remounts alone do not solve overlapping reads for one material.

## R8 — retire guidance before native open dispatch

The actual repository wiring currently bundles inspect+open in one awaited port. A superseded A inspection can finish after B and still open A, even though its final result is suppressed.

Put an ownership check between inspection completion and open dispatch on the real `navigationControllerFor` path. Keep cancellation/retirement inside the controller's observable ordering or provide a demonstrated equivalent seam. Do not pass unserializable JavaScript cancellation functions through Tauri.

Test actual port composition, not only a controller port that instantly records “guidance”. Hold A inspection, finish B, release A and prove only B opens. Cover abort/dispose, a newer failed request, source-link unmount/route retirement and legitimate guidance success.

Guidance must still save no position, reserve no token and confirm no reading. Do not claim an already-dispatched OS action can be undone; prevent obsolete dispatch where it remains preventable.

## R9 — resolve the exact-head CI failure honestly

Preserve failed run38985040191 at head6d8c608. It failed npm test:3422 passed/1 failed/6 skipped. Failure: `skillScreens.test.ts`, `two quick clicks on Save record one observation`, missing Add an observation dialog.

The isolated suite passes locally. That alone is not proof of an unrelated flake. Investigate the actual readiness/dialog/lifetime sequence using observable gates and, if useful, a controlled accepted-main comparison. Keep the double-click protection and its assertions meaningful. Make the smallest demonstrated correction; separate any pre-existing issue honestly from new navigation defects.

Do not suppress the failure, add blanket retries or inflate global timeouts. Do not rerun indefinitely until green. Preserve the first red receipt, record the cause/evidence and require successful normal CI on the final exact PR head.

## R10 — validate trusted count as well as hash

The native equal-hash fast path trusts cached total_pages. The frozen test uses a genuine50-page PDF, an inflated cache of500 accepted by the current navigation verifier, and the actual checked native commit of page450. It currently commits=true.

At the native content-sensitive boundary derive/validate the hash and count from authoritative PDF bytes, including equal-hash/inconsistent-count cache cases. Reuse existing parsing. Repair/reconcile metadata coherently, then refuse a stale or out-of-bounds request without clamping or falsely verifying an impossible position.

Cover inflated and deflated counts, valid unchanged cache, invalid/non-PDF bytes behind misleading cache metadata, bookmarks and read-confirmation bounds. Preserve file-replacement/deletion/relink/retry regressions. Browser tests may prove database semantics but must not claim native PDF inspection.

Document the policy for inconsistent restored/corrupt cache data and keep stale tuple/identity/status changes atomic and explainable.

## Preserve useful behavior and evidence

- Keep R1's exact read-confirmation hash/generation binding and R2's request-bound success checks.
- Keep genuine schema14 tamper refusal and current-schema tamper cases, plus the bounded test-driver fix.
- Preserve all shared operation/validation fixtures, upgrade/rollback/backup/restore/cascade checks, narrow permissions and default-reader guidance.
- Do not edit shipped migrations1–14, dependencies, version files or release configuration. No new schema should be needed for these corrections; justify a contract change explicitly if one is necessary.
- Correct the completion report's claim that replacement followed by restoration between two reads is necessarily detected. Unobserved same-bytes ABA cannot be proved by endpoint hashes. Describe actual guarantees and external-reader limitations precisely.
- Keep installed behavior UNVERIFIED. No app launch or profile operation is part of this assignment.

## Pace, checkpoints and verification

Work continuously through all six groups. Update the existing implementation checkpoint at meaningful milestones with exact HEAD, dirty/staged/untracked state, completed findings, raw exits, blockers and the exact next action. If usage/context ends, leave a durable resume state instead of a vague completion claim. Use logical local commits and preserve partial work. If the work finishes, stop rather than spending remaining usage on unrelated tasks or redundant tests.

Run focused tests first. Then one final sequential gate on the finished source, with Node22 and established scoped SDK26.5:

```bash
npm run typecheck
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run test:cargo-lock
node --test scripts/mac-schema14-profile-snapshot.test.mjs
git diff --check origin/main...HEAD
```

Before committing use `git diff --check origin/main`. Verify required checksum manifests and ensure every referenced receipt is actually tracked. Keep failures separate from final passing receipts; do not rewrite them. Repeat broad tests only after meaningful changes, failures or unresolved evidence justify it.

## Deliver and stop

Update PR189, not a competing feature PR. Provide one R5–R10 issue-to-test map, source hashes, complete evidence checksums, exact native/browser guarantees, final gate exits and remaining limitations. Reconcile current tracker history and affected current manifests without erasing prior entries.

Remove only your disposable diagnostics after promoting the regressions. Push the complete corrected package, wait for exact-head CI and stop for Codex review. No self-merge, new roadmap task, provider calls, profile/key use, desktop launch, installer build, signing or release publication. Owner approval for the existing scope persists; do not ask for it again.
