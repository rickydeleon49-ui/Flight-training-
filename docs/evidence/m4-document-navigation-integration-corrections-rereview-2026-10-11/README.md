# M4 integration corrections re-review (round 2) — evidence pack (2026-10-11)

Reviewer: Codex (senior review). Subject: the M4-R9–R12 correction package in
`/Users/rickymac/code/Flight-training-m4-viewer-evaluation` (branch `codex/m4-navigation-viewer-evaluation`,
base `c28ab8482c8635b0b2bf74686b081e02bf448f65`), report
`docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_REPORT_2026-10-11.md`, pack
`docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/`.
Reviewer base: accepted main `c32918b` (M3 production merged as #140).
Outcome: **corrections required — M4-R13–R22** (5 P1, 5 P2). M4 remains evidence-only.

## What is in this pack

```
README.md                                   this file
submitted/                                  byte-faithful copies of the evaluated submission files
  contractModel.mjs                         608be112…   (matches the submitted pack)
  persistenceProtocol.mjs                   1ffd53da…   (matches the submitted pack)
  openerController.mjs                      58d07838…   (matches the submitted pack)
  proof.test.mjs.submitted                  cfc88c53…   (matches; .submitted suffix avoids re-running it here)
  realParserDemonstration.mjs               96d5a711…   (matches the submitted pack)
  run_integration_proof.mjs                 b2704743…   (matches the submitted pack)
  candidate_migration_0015.sql              78e0898f…   (matches the submitted pack)
review-repro.mjs                            the behavioural reproducers (R13–R19, R22)
verify-submitted-hashes.mjs                 frozen 32-path + delivered-pack manifest verification (R20)
candidate-coexistence.mjs                   shipped-migration / candidate 0014–0015 coexistence probe (R21)
pdfjs-one-build.mjs                         one-entrypoint-per-process PDF.js harness (R22); exits 0 only if all fixtures match
pdfjs-submitted-demo.mjs                    runs the SUBMITTED demonstration unchanged to show its real exit behaviour (R22)
fixtures/                                   the five synthetic PDFs + manifest, byte-identical to the submitted pack
receipts/                                   raw outputs, both engine lanes
```

Every reproducer resolves its modules from `submitted/`, so the findings replay from a clean clone of
`main` with no dependency on the implementation worktree. The two scripts that *do* need the submission
worktree (`verify-submitted-hashes.mjs`, and the reviewer's own suite re-runs) name their target and
command in the receipt header.

## Commands actually executed

```sh
# lane A (project engine, repo engines-supported):  /opt/homebrew/opt/node@22/bin/node  -> v22.23.3
# lane B (disclosed scratch engine used by the submission): system node               -> v26.10.0

cd /Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training-
<node> docs/evidence/m4-document-navigation-integration-corrections-rereview-2026-10-11/review-repro.mjs
<node> docs/evidence/m4-document-navigation-integration-corrections-rereview-2026-10-11/verify-submitted-hashes.mjs
<node> docs/evidence/m4-document-navigation-integration-corrections-rereview-2026-10-11/candidate-coexistence.mjs

# reviewer re-run of the submitted suites (read-only: in-memory DBs and mkdtemp scratch only)
cd /Users/rickymac/code/Flight-training-m4-viewer-evaluation
<node> --test docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/proof/proof.test.mjs
<node> --test docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/proof/databaseLifecycle.test.mjs
<node> --test docs/evidence/m4-document-navigation-integration-corrections-2026-10-11/proof/sensitivityMutants.test.mjs

# reviewer PDF.js harnesses. The pdfjs root below is the previous round's untracked scratch
# install — this pack deliberately ships no engine, because that coupling is itself finding R22.
PJ=<worktree>/docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/scratch/pdfjs-engine/node_modules/pdfjs-dist
<node> docs/evidence/m4-document-navigation-integration-corrections-rereview-2026-10-11/pdfjs-one-build.mjs \
       legacy/build/pdf.mjs "$PJ" docs/evidence/m4-document-navigation-integration-corrections-rereview-2026-10-11/fixtures
<node> docs/evidence/m4-document-navigation-integration-corrections-rereview-2026-10-11/pdfjs-one-build.mjs \
       build/pdf.mjs "$PJ" docs/evidence/m4-document-navigation-integration-corrections-rereview-2026-10-11/fixtures

# the submitted demonstration unchanged: must be run with cwd inside the implementation worktree
cd /Users/rickymac/code/Flight-training-m4-viewer-evaluation
<node> <review-pack>/pdfjs-submitted-demo.mjs <review-pack>/fixtures
```

## Receipts and which finding each supports

| Receipt | Finding | Measured result |
| --- | --- | --- |
| `repro-node22-v22.23.3.txt` | R13, R13b, R14, R15, R16, R17, R18, R19, R22 | one JSON line per probe id; ids `R13-obsolete-write-commits`, `R13b-repair-failure-silent`, `R14-repair-publishes-obsolete-identity`, `R15-unknown-destination-count-resolves`, `R16-label-map-not-content-bound`, `R17-opener-trusts-caller-count`, `R18-overflow-guard-unreachable`, `R19-writer-unknown-identity-throws`, `R22-parser-path-and-engine` |
| `repro-node26-v26.10.0.txt` | same set | identical to lane A except `R19.saveReadingState_missing_hash`, whose raw SQLite message differs by engine (documented in the review) |
| `manifest-node22-v22.23.3.json`, `manifest-node26-v26.10.0.json` | R20 | frozen paths: **30/32 unchanged**, 2 changed = the two documents this round had to revise, 0 missing. Delivered pack: recorded 26, delivered 27, **matching 20, stale 6** (`receipts/01`–`06`), 0 unrecorded |
| `suite-rerun-node22-v22.23.3.txt`, `suite-rerun-node26-v26.10.0.txt` | retained-work verification | `proof.test.mjs` 21/21, `databaseLifecycle.test.mjs` 7/7, `sensitivityMutants.test.mjs` 2/2, all exit 0 on **both** lanes |
| `coexistence-node22-v22.23.3.json`, `coexistence-node26-v26.10.0.json` | R21 | submission premise applies 13 migrations/38 tables; accepted main applies **14 (incl. `0014_skills_evidence.sql`) + candidate 0015 → 44 tables, no number clash**, bounded writers normal. Candidate numbering coexists; the pack itself never proves it |
| `parser-demo-node22-raw-failure.txt` | R22 | submitted demonstration on the project lane is an **uncaught** `TypeError: Promise.try is not a function`, process exit 1 — not a disclosed skip |
| `parser-legacy-entrypoint-lanes.txt` | R22 | same pinned `pdfjs-dist@6.3.289`: `legacy/build/pdf.mjs` **PASS exit 0** on Node 22 *and* Node 26 (50/10/1/16 pages, `InvalidPDFException` for the malformed fixture); `build/pdf.mjs` **exit 1** on Node 22, PASS on Node 26 |

## Reviewer-side environment and hygiene notes

- Node 22.23.3 (npm 10.9.9) used for the project lane; the machine default Node 26.10.0 for the scratch lane.
  `package.json`/`package-lock.json`/`Cargo.lock` were not touched by the reviewer.
- `node:sqlite` reports SQLite as an experimental feature on Node 22; warnings are retained verbatim in receipts.
- The reviewer ran `git add -n` (dry run) only when checking whether the submission would be normalized by
  `.gitattributes`; nothing was staged in the submission worktree (`git diff --cached` empty afterwards).
- The submission worktree was used read-only. Reviewer suites used in-memory and `mkdtemp` scratch only.
- No production source, dependency, shipped migration, installer, signing, release, provider call,
  physical test-account run or everyday-profile access was involved. The primary checkout and the M3
  scope worktree showed no file modifications in the review window. G1–G3 remain deferred/unexecuted/unverified.
- Raw receipts are unedited; the only reviewer-authored summary lines in them are the `#`-prefixed header
  and conclusion lines, which are visually distinct from captured output.
