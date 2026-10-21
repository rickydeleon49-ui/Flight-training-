# Research documentation handoff — 21 October 2026

## Assignment and state

The owner asked for a precise research dive into six proposed differentiators and for them to be added to the roadmap. Codex implemented this **documentation-only** round. Claude remains the independent reviewer and merger under [AGENTS.md](../AGENTS.md). After the initial local handoff, the owner explicitly requested that all research and roadmap work be put on GitHub (21 October). That request authorizes Codex to commit/push this documentation branch and open a review PR, overriding the normal implementer publication restriction for this documentation task only. No self-approval, merge, application test, installer or release is authorized or claimed.

- Repository: `rickydeleon49-ui/Flight-training-`.
- Baseline: main `2b5b146543e1dfa30e056ab416ee9067a3b6fe5e`, PR #256; package 0.5.7/schema 20.
- Author branch: `docs/offline-training-research-2026-10-21`, initially clean at that baseline.
- Named author checkout: `C:/Users/ricky/Documents/Codex/2026-09-06/continue-work-on-my-private-github/outputs/mac-github-prep-2026-10-02/repo`.
- Current Mac implementation, its worktree, the external round folders and live loop JSON were not touched. Do not apply these files over an active implementation checkout or assume this author can see its uncommitted work.
- Research-completion remote check: `origin/main` still equaled the recorded baseline. [PR #257](https://github.com/rickydeleon49-ui/Flight-training-/pull/257), “HW-01d part 2: quiz completion evidence and homework in the daily plan,” is open on `codex/offline-gen`. Its title/status were inspected only; its source/approval is not reviewed by this research. At that research snapshot it owned the active implementation lane and was not preempted by the six planning groups.
- Publication preflight: main advanced to `f6ba13a259fcb6203eafb797638ab35f4336cfd2`, merging PR #257. The nine research documents did not change upstream. The research and acceptance plan remain a dated source inventory of PR #256; statements about unfinished HW-01d test-run/daily-plan wiring describe that baseline, not current main. Reconcile those dependencies against the merged HW-01d report before assigning implementation; no independent review of PR #257 is claimed here.

## Files to review

| Path | Change |
| --- | --- |
| `ROADMAP.md` | New dated top entry, six DIFF acceptance groups, current-code reconciliation and preserved owner order. Older snapshots remain. |
| `STATUS.md` | Research-only entry with no new implementation/test/readiness claim. |
| `docs/PROJECT_HANDOFF.md` | Names this research round, roles, baseline and publication boundary. Existing owner workflow preserved. |
| `docs/MAC_PARITY_CHECKLIST.md` | Cross-platform verification implications; no checklist result changed. |
| [Research](OFFLINE_TRAINING_RESEARCH_2026-10-21.md) | Competitor verification, primary-source synthesis, actual source inventory, licensing/compatibility assessment, access limits and validation strategy. |
| [Implementation roadmap](OFFLINE_TRAINING_ROADMAP_2026-10-21.md) | Six concrete outcomes, existing integration points, bounded slices, acceptance tests, sequencing and scope decisions. |
| [Repository snapshot](research/offline-training-2026-10-21/repositories.json) | Five public upstream API observations, pinned commit/license URLs and hashes; no copied code or adopted dependency. |
| This handoff and [validation receipt](research/offline-training-2026-10-21/validation.json) | Provenance, documentation checks and cross-machine transfer. The receipt records the actual performed checks, not app passes. |

## Main review points

1. **Competitor accuracy:** Google explicitly documents remembered flashcard progress, resumed review, missed-card practice and offline audio. The research does not claim those are exclusive or that undocumented functionality is absent.
2. **Reuse:** M2 attempts/cards, `simple-v1`, M4 identity/page guidance/bookmark notes, kit/authoring provenance, homework, existing briefing and output contracts already exist. New work is their coherent integration and remaining gaps.
3. **Current source versus old text:** GEN-03 and HW-01b/c/card-run work are merged at the baseline despite stale paragraphs in existing trackers. Schema 0020 is registered. Homework test runs/daily-plan wiring and OFFLINE-ON activation/pressure acceptance are not marked complete.
4. **No priority rewrite:** the existing HOMEWORK/EXPORT/ACS/SCHOOL/FLIGHTLOG order and active ownership stay intact; six groups refine overlapping work and queue unassigned gaps.
5. **Format boundaries:** current full backup v3 with v1/v2 readers is different from packet v1. The latter carries no PDFs or attempt/review history and does not restore machine page/per-item provenance. Current-schema iOS support is unverified; old schema-9 notes are not its specification.
6. **Source/assessment honesty:** external-reader handoff does not prove a page jump. Source offsets have declared units; SHA-256 does not prove authorship; ratings, self-assessment and instructor observations are distinct. No app efficacy/proficiency claim was measured.
7. **Gates preserved:** local models excluded; no package exception, retention slider, migration number, reader/minimum-OS change, voice/cloud fallback or automatic merge/sync approved. M5 measurements are not minimum-spec acceptance. Inspect current release policy rather than carrying forward an obsolete release hold.

## Independent review and cross-machine publication

Prefer fetching `origin/docs/offline-training-research-2026-10-21` into an isolated review worktree on the Mac after the owner-requested publication. The GitHub branch contains all nine repository documents and metadata/validation records listed above. The local review bundle is an earlier, immutable research-completion snapshot; its publication wording predates the owner override. Use that bundle only as an alternative historical transfer source when the branch is unavailable. Its `tracked.patch` contains only the four modified existing Markdown files; `new-files/` contains the five new research/roadmap/handoff/metadata/receipt files. `tools/` contains the author's built-in-Node metadata collector and documentation validator for inspection/reproduction, not an application gate. The validator expects the recorded author baseline/branch and rewrites its own receipt; preserve the author's receipt before reproducing it, and independently reconcile checks if reviewing on a newer base. `bundle-manifest.json` hashes every payload file. No real profile, application source code, database, credential, dependency directory or binary is included.

Before applying anything: fetch GitHub; read current AGENTS, ROADMAP and active loop; record current branch/HEAD/status and open work. Use an isolated documentation branch/worktree chosen by the reviewer. Check the bundle's hashes and run `git apply --check` on the patch. **Do not overwrite another machine's latest ROADMAP/STATUS/HANDOFF.** If main advanced, reconcile only the new dated sections against current owners and source; preserve newer decisions and record the reviewed baseline. Copy new files only after checking for name collisions. The bundle is reviewable source material, not a claim of publication or a ready-to-run feature task.

Independently inspect the source claims/primary citations, count/metadata consistency, introduced relative links, privacy, whitespace and docs-only scope. Reproduce the documentation checks from the receipt. A source or test edit discovered necessary during review is a separate round, not a silent expansion. Follow the current AGENTS reviewer recipe and applicable owner instructions for required gates; distinguish documentation validation from app/device verification. No mutation tests were invented for prose and no unchanged application suite is claimed as fresh evidence here.

For this owner-requested publication, Codex commits/pushes only these documentation changes and opens a review PR without approving or merging it. After an independent GREEN review, the assigned reviewer makes any needed corrections, waits for required CI on the exact head and merges with a matching-head guard. Use the existing documentation-only CI path when the final diff remains documentation; do not alter workflows or force empty reruns. Confirm the accepted commit is on `origin/main`, update the reviewer receipt/loop under its normal rules, and only then describe the plan as accepted on main. The published review branch is available cross-machine before acceptance.

**Next implementation is still the already assigned Mac round.** This task does not start DIFF-01–06, take ownership of HOMEWORK-01, start a renderer or repeat accepted offline preparation. When a DIFF slice is actually assigned, its specific source, privacy, failure, mutation, performance and installed-platform acceptance is in the implementation roadmap.
