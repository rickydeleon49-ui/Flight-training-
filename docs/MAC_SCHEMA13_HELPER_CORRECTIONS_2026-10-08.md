# Mac schema-13 helper and operator-kit corrections — 8 October 2026

Closes **MACV-R4, MACV-R5 and MACV-R6** from
`docs/MAC_SCHEMA13_PREPARATION_REREVIEW_2026-10-08.md`, together, in one bounded round.
**MACV-R3 is accepted and left alone:** both `*-adhoc.dmg` candidates are byte-identical to the ones the
re-review verified, and nothing was rebuilt, rebundled, re-signed or republished. The accepted application
source, PR #125 and the scope/acceptance chain are not reopened. **G1–G3 remain UNEXECUTED / UNVERIFIED**
and the post-receipt recovery subcase remains BLOCKED — they need a person at the `hfdtest` desktop.

## Starting state, verified before editing

- Read the corrections assignment, the re-review, its pack README/manifest/diagnostics and receipts, and
  the prior MACV-R1–R3 review, submitted correction report, runbook and current STATUS/handoff. The
  review documents were read from `origin/main` (`8973df3`, PR #127) with `git show`; **the dirty primary
  was not pulled, reset, checked out or stashed over.**
- `/Users/rickymac/code/Flight-training-`: HEAD `36a7b39`, 3 modified + 5 untracked paths from the
  previous round still present, `staged=0`.
- **All 28 frozen submitted hashes verified against the working tree before editing: 28/28 match — no
  competing changes to report.** Re-verified after the work: **25/28 match**, and the three differences are
  exactly this round's own edits — `scripts/mac-schema13-profile-snapshot.mjs`, `STATUS.md` and
  `docs/PROJECT_HANDOFF.md` (`receipts/anchor-verification.txt`, final values in
  `receipts/final-source-hashes.txt`).
- The 13 production source anchors from the previous review: **13/13 still byte-identical** — no
  application source, migration, config, lockfile or candidate artifact was touched.
- Both accepted installers still `b3ead813…` (NEW) / `ddb0594e…` (OLD); the two rejected originals are
  still `6aecab86…` / `455eb12d…`; both earlier evidence packs remain in place untouched. Archival
  checkouts were not opened. Reuse of the recorded approvals only (`hfdtest` uid 502 standard account,
  synthetic disposable data, local ad hoc unsigned candidates): no new authorization sought, no everyday
  profile use, no Developer ID/notarization provisioning, no publication, no v0.5.3 replacement, no
  provider call, no GUI launch anywhere.

## MACV-R4 — stopped-app, isolation and output boundaries now fail closed [P1]

**Process inspection is classified, not caught.** `classifyProcessProbe` turns each probe result into
exactly one of `stopped | running | error | unavailable | malformed`; only pgrep's documented no-match
exit status 1 is success. Exit 2/3, a signal death (no exit status), `ENOENT`/`EACCES`, exit 0 with no
pid, and unparseable pid text are all distinct non-stopped states, and `guardProfile` refuses on any of
them. The refusal now sits **outside** every `try`, after the structural and ownership checks and
**before** anything opens or copies the database. Both candidate installs are probed
(`-f 'Her Flight Deck.app/Contents/MacOS/her-flight-deck'` and `-x her-flight-deck`); any non-`stopped`
answer refuses, so sandbox inability to inspect processes can no longer be read as "nothing is running" —
the exact gap the re-review saw when the submitted self-check passed 8/8 while `pgrep` was failing.

**The read-only boundary is now real, not just a read-only handle.** The operator entrypoint hard-requires
the approved lane: actual uid 502, `hfdtest` resolving to 502, no `admin` group membership (confirmed by
two independent probes, both failing closed), and a data root whose `lstat` is a real owned directory whose
`realpath` equals the canonical `/Users/hfdtest/Library/Application Support/com.herflightdeck.app`.
`--profile` and `--expect-uid` can no longer retarget anything: omitting them yields the approved target,
and supplying a different one is a refusal. There is no CLI flag that relaxes any of this; the scratch
fixtures live on an internal test path that `parseArgs` cannot construct, and it only accepts a root that
is a `com.herflightdeck.app` directory inside a task-owned `hfd-snapshot-selfcheck-*` scratch under the
real temp dir. Symlinked roots, symlinked or non-regular sidecars, and hard-linked database files are
refused; `documents/` is walked recursively and any symlink inside it refuses.

**No output can land on an input.** `guardOutputPath` runs before anything is read or copied and rejects a
destination inside the profile root, one that aliases the database/WAL/SHM or a managed document or an
input receipt — by resolved path **and** by `dev:inode`, which catches hard links — plus symlinked and
non-regular destinations and relative paths. The CLI additionally requires a fresh destination
(`wx` + pre-check), so previous evidence is never clobbered; `compare --json` cannot overwrite either
receipt. If a WAL copy fails or the originals change mid-copy, the scratch is removed in the failure path
and the failure is surfaced as a refusal, and the whole profile is only ever read as a quiescent snapshot.

**Permanent coverage** (self-check `receipts/selfcheck-final.json`, all passing): 12 production-classifier
cases; 8 **composition** cases that push synthetic pgrep results through the real classifier into the real
guard; the four state refusals each proving no receipt was written and the database bytes were untouched;
a case that makes the database unreadable (`000`) and shows the refusal still comes from the guard, not
from `EACCES`, with no copy-scratch created; a failed-copy cleanup case; symlink/non-profile/loose-file/
wrong-uid refusals; and nine output-protection cases including hard-link, symlink, inside-profile,
relative, alias-of-input-receipt and refuse-existing. `determinism.txt` records three consecutive identical
runs of both harnesses.

## MACV-R5 — complete digests and explicit comparison purposes [P1]

**Stored values are hashed exactly.** `quote()` and delimiter joins are gone. Each cell is encoded by its
real `typeof()` into a length-prefixed frame: `NULL` (no payload), `INTEGER` as the exact decimal read with
`setReadBigInts` (so `9007199254740993` ≠ `…992`), `REAL` as its 8-byte IEEE-754 pattern (`1` vs `1.0` vs
`-0.0` vs `0.0` all distinct), and `TEXT`/`BLOB` as the full stored bytes from `hex(col)` — which is what
the reviewer's NUL case needed, because node:sqlite truncates a TEXT value at the embedded NUL and SQLite's
own `quote()`/`length()` do too (recorded explicitly: `hex = 6265666f7265006f6e65` while the JS string is
`"before"`). The frame carries the table identity, the ordered column list and the real primary key, so no
stored byte sequence can imitate another row/column layout. Ordering always uses the real primary key, and a
declared key that disagrees with the schema — or a table without one — is a refusal instead of an arbitrary
row order.

**The inventory is the shipped schema.** 33 retained tables (0001–0012) are digested, now including the
operation ledgers `practice_session_operations`, `card_review_operations` and `debrief_operations`, plus the
two 0013 tables reported separately, the migration ledger with its full row content, every schema object
(table/index/trigger names + SQL) as a digest, `documents/**` file bytes, and the runtime files
(`backups/**`, `last-run-version.txt`, restore staging) recorded **separately** so a legitimate startup or
safety artifact is never mistaken for changed library content. `inventory.complete` must be true and no
required table may be absent.

**Snapshots are validated before any verdict.** Structure, schema tag, absolute profile, database name,
owner uid, ledger shape (known table, increasing non-empty versions), one digest entry per required table
with 64-hex value and column identity, both 0013 presence facts, unique well-formed file anchors, complete
inventory, isolation facts with a confirmed-stopped inspection. Anything missing is a refusal, never an
empty-map pass — including the two-missing-history-maps case the frozen harness proved.

**Four explicit contracts**, each with its own CLI call and its own verdict field
(`verdict = PASS | FAIL | PARTIAL`, `gateEligible`, `retainedMeaning` stated inside the receipt):

| Purpose | Contract | Gate |
| --- | --- | --- |
| `unchanged` | all 33 retained tables + complete ledger identity + managed-file bytes + presence facts identical; **does not** require schema-13 tables or version 13, so a correct older-binary refusal scores as a pass | eligible |
| `upgrade` | genuine populated schema-12 baseline → 13: retained data identical, ledger rows a strict prefix with 13 added, both 0013 tables present, only 0013's two tables + four indexes added | eligible |
| `restore` | genuine schema-12 backup baseline → restored 13: retained history **and** document bytes identical, ledger migrated; a changed document fails even with identical history | eligible |
| `history` | retained digests only; `gateEligible: false`, `verdict: PARTIAL`, `complete: false`; `--history-only` resolves here | **never** |

The baseline for `upgrade`/`restore` must actually contain a completed attempt, its responses, card state
and card event, plus at least one managed document — an empty fixture library is refused, not credited. A
v1-shaped (declared-subset) snapshot is still accepted for compatibility and still answers
`retainedHistoryUnchanged`, but is explicitly marked non-gate-eligible, so no subset capture can certify a
physical gate.

**No assertion was rewritten:** the frozen harness is unmodified (its hash matches the reviewer's published
`SHA256SUMS` entry) and now reports **10/10 pass, exit 0**, having reported 3/7 before. The seven behaviours
are promoted into the helper's own self-check, and `revert-sensitivity.sh` reverts each one to show the
named assertion fails — including `output-alias-both-branches-off`, where removing the protection corrupts
the scratch database (`file is not a database`) rather than merely failing a check. Both the original
failing receipt and the final passing receipts are in the pack.

## MACV-R6 — a standalone, self-consistent human kit [P2]

`RUNBOOK-G1-G3.md` is now an operator kit that needs no repository access: it is staged with the two
accepted installers, fixtures A/B/C, the offline packet, the helper and `env.sh` under
`/Users/Shared/hfd-schema13-kit-2026-10-08/`, with a `TRANSFERSHA256SUMS.txt` the operator re-verifies
inside `hfdtest` before anything runs (recorded: all `OK`, and the installer/fixture/packet hashes equal
the accepted values — the existing candidates are verified, not replaced). It also states plainly that
`/Users/Shared` is world-writable, so a mismatch means stop.

* **Snapshots only after a confirmed stop.** Every capture point is preceded by an explicit Cmd-Q plus
  `$HFD_OP stopped`; the A1/A7/B3/B6/B7/D3 live-snapshot instructions are gone, replaced by
  quit → confirm → snapshot → compare, with relaunch by the exact per-user path only where the next UI
  observation needs it. The helper enforces the same rule, so a mistake refuses instead of silently
  reading a live library.
* **One purpose per gate.** G2 uses `--purpose upgrade`, G3 refusal `--purpose unchanged`, G3 restore
  `--purpose restore`, and the partial `history` mode is labelled as never certifying a gate. The Step-D
  `--history-only` call and its verdict schema are corrected together.
* **Corrected nested C2.** Parent P = B **101–300 of 1,050** (200 pages); C2 = P's own **41–60** → 20-page
  child at root **141–160 of 1,050** (the earlier "60–80" was wrong), with copy destinations **41** into P
  and **141** into B. C1's 120–140/21 pages and A's 3–7/5 pages are preserved, as are the real sibling
  groupings, clipboard-vs-viewer distinctions, cancel-before-save assertions and the reachable failure.
* **Switches are validated, reversible and named.** `move`/`copy` accept only the approved root or a path
  under the kit's own `profiles/`; both require uid 502 + standard account when the approved root is
  involved, require a confirmed stop, require an absent destination (no nesting or clobbering on a rerun),
  refuse a loose file, refuse self-nesting, and **nothing is ever deleted** — the refusal-test profile is
  moved to `profiles/schema12-refusal-test` and stays there. `block-backups` records the directory's
  original mode into the evidence folder first and refuses if it is already blocked; `unblock-backups`
  restores that recorded mode and verifies it, and the walkthrough says to run it on success, on failure
  **or** on abort. 15 cases pass in `receipts/operator-selftest.json`, including proof that the refused
  operations left both profiles intact.
* **Commands are executable.** Every path is absolute or an explicitly defined task variable sourced from
  `env.sh`; there are no `…` or angle-bracket placeholders inside a command, `HFD_EVID` is created once and
  restored by a pointer file in later sessions, destinations are fresh by construction, and no command
  assigns `HOME`/`CODEX_HOME`. Backup identity is recorded as sha256 + `manifest.json` + `unzip -l` payload
  count/byte sum (the shared `0.5.3` version alone cannot distinguish OLD from NEW), the refusal step names
  the exact tables/files expected unchanged and treats `backups/` artifacts as non-evidence, and automatic
  cases ask for real ids/titles, complete coverage, sizes and responsiveness.
* The post-receipt pending/reconcile/cancel subcase stays **BLOCKED / source-covered** with the same
  smallest-seam proposal, unchanged and unimplemented.

## Changed paths, mapped to findings

| Finding | Paths added / changed |
| --- | --- |
| MACV-R4 | `scripts/mac-schema13-profile-snapshot.mjs` (classified inspection, guard ordering, operator lane policy, output alias/freshness protection, copy-failure cleanup and quiescence re-hash) |
| MACV-R5 | same helper (framed typed digests, real-PK ordering, 33-table inventory + schema objects + runtime/protected file split, snapshot validation, four purpose contracts and verdict schema) |
| MACV-R6 | `RUNBOOK-G1-G3.md`, `env.sh`, `hfd-operator.sh` (+ staged copies under `/Users/Shared/hfd-schema13-kit-2026-10-08/`) |
| regressions | `hfd-operator-selftest.sh`, `revert-sensitivity.sh`, `verify-anchors.sh` + 19 files under `receipts/` |
| tracking | this report, the pack `README.md` + `SHA256SUMS`, `STATUS.md`, `docs/PROJECT_HANDOFF.md` |

Nothing else changed. `.gitattributes` was **not** modified this round: the pack scan shows zero
trailing-whitespace lines and zero CR bytes, and `git check-ignore` reports no pack file ignored, so a plain
`git add` of the pack loses nothing.

## Verification, evidence and boundary

* `receipts/diagnostics-final.json` — frozen review harness, unmodified
  (`14c40581fb225207b10b3dff4ec5a0ddde98ac683903e75016512388a01c74ca`): **10/10 pass, exit 0**, against
  3-pass/7-fail before.
* `receipts/selfcheck-final.json` — helper self-check on isolated scratch data, node 22.23.3:
  **74 checks, 74 pass, `allPassed: true`, exit 0**; `receipts/determinism.txt` shows three byte-identical
  runs of each harness.
* `receipts/revert-sensitivity.json` + notes — eleven reverted behaviours, each mapped to the assertion that
  breaks; `receipts/operator-selftest.json` — 15 kit-script cases, `allExpectationsMet: true`, exit 0.
* `receipts/anchor-verification.txt` — 28 frozen hashes (**25 match**; the three differences are this
  round's own helper + STATUS + handoff edits), 13 production anchors (13/13), candidate installers and
  rejected originals unchanged, `staged=0`, toolchain `node v22.23.3 / npm 10.9.9 / Darwin 27.0.0 arm64`.
* `receipts/final-source-hashes.txt` — the exact final hash of every path this round produced or changed,
  plus the staged kit copies, for the reviewer to bind.
* `receipts/kit-transfer-manifest.txt` + `kit-transfer-verify.txt` — 10 staged files, `shasum -c` all `OK`.
* No full application test matrix was rerun, as the assignment scoped: this round changes a standalone
  helper and documentation only, and the three verification runs above are byte-reproducible.
* Nothing was published, pushed, committed, signed, notarized or installed; no app was launched and no
  real profile of any account was read. Repo state: HEAD `36a7b39`, `staged=0`, this round's output left
  **uncommitted and unpushed** for independent senior review.

## Exact next human steps (only a person in `hfdtest` can do these)

1. Log into `hfdtest`; `source /Users/Shared/hfd-schema13-kit-2026-10-08/env.sh`; run the four identity
   commands in walkthrough §1.1 and `shasum -a 256 -c TRANSFERSHA256SUMS.txt` in §1.2; stop on any mismatch.
2. Install both DMGs into the two distinct folders (§1.3), verify both inner executable hashes, and record
   exactly what macOS does at first launch (per-app flow only; a block is a finding, not a pass).
3. Walk §2→§5 in order, quitting and confirming `$HFD_OP stopped` before every snapshot, comparison, copy or
   switch, and recording each command, exit status, JSON, screenshot and the full backup manifest/hash.
4. Run `$HFD_OP unblock-backups` even if the failure test was abandoned mid-way, and keep the recorded mode.
5. Send back the whole `$HFD_EVID` folder, the `profiles/` listing and every screenshot. Until those exist,
   G1–G3 stay UNVERIFIED and the post-receipt subcase stays BLOCKED; a clean helper self-check, a green
   frozen harness and a passing `shasum -c` certify nothing about the installed app.

Work is left **uncommitted and unpushed** for independent review.
