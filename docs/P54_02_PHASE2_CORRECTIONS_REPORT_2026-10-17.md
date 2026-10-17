# P54-02 phase 2 corrections P54P2-R1–R4: report

**Proof/runner/evidence corrections only. Pending independent review; no self-merge.** This is not production search, not engine adoption and not P54-02 acceptance. Claude implemented it on the PR199 branch `claude/p54-02-worker-proof`, on top of the reviewed head 9b202c0 (base d080efa), under [the correction assignment](P54_02_PHASE2_CORRECTIONS_PROMPT_2026-10-16.md).

The pre-registration (a7813e7), the original report, and the original evidence directory with its failed-first-suite receipt are all unchanged. New sources and receipts are in [`evidence/p54-02-phase2-corrections-2026-10-17/`](evidence/p54-02-phase2-corrections-2026-10-17/README.md). No application file, dependency, migration or profile changed. The runner compared 5,727 repository files by content and found no changes.

## Results

| Group | Baseline on 9b202c0 (before fixes) | Corrected |
| --- | --- | --- |
| **R2** EOF while alive | External safety kill needed at 3.006 s | `failed:stream_closed_while_running` at 203 ms (200 ms deadline). Killed with signal 9 and reaped; no external kill |
| **R2** complete result, then exit 3 | `checked`, `indexed: 1` | `failed:worker_exit`, exit 3; nothing retained as checked, nothing indexed |
| **R2** complete result, then stall | External safety kill needed at 3.004 s | `failed:no_exit_after_result` at 202 ms, killed and reaped; nothing indexed |
| **R2** normal result, exit 0 | (control) | `checked`, exit 0, indexed exactly once |
| **R3** extraction exit 17 / index exit 23 | Runner exit 0, PASS printed | Exit 2 (`measure-extract` / `index-100-1`) |
| **R3** files changed during the run | `applicationFilesUnchanged:false`, exit 0, PASS | Exit 4 (`preservation`), with the changed paths listed |
| **R4** over-limit input | Worker spawned (`workersSpawned: 1`) and refused afterwards | Refused before any spawn: `process: null`, 0 workers |
| **R4** oversized replacement at publication | Unbounded `fs::read` of the replacement (source inspection; no OOM run) | Refused **unread**: `callerBytesRead: 0`, `replacement_over_input_limit`, no indexing |

## R1: complete, Git-verifiable evidence

- **The 12 missing original logs were not recoverable.** The root `*.log` ignore rule kept them out of Git, and the implementer's scratch cleanup deleted the local copies after PR199 opened. The original directory is left as published, with its 42-entry `SHA256SUMS` still naming the 12 absent members. That history is disclosed rather than repaired.
- **Replacement receipts.** A separately labeled replacement run of the corrected proof (`final/runner/`) supplies complete raw logs: the build, the suite, `measure-extract` and nine index runs, with all `time -l` stderr.
- **Publication.** Every member of the new directory is force-added. Raw logs get exact-path `-text -diff` attributes, so their bytes are kept unmodified. `SHA256SUMS` and the machine-readable `inventory.json` (bytes, hash, role) were verified against **Git index blobs** (`git cat-file`) before commit, not against the filesystem.

## R2: one bounded settlement boundary

`Supervisor::settle` is now one loop that owns the whole lifecycle:
- **Kept active throughout:** the original deadline and the RSS watchdog (until exit) stay active through the result frame, end of stream, shutdown and reaping.
- **EOF:** end of stream no longer blocks in `child.wait()`; the loop keeps polling `try_wait` under the same deadline.
- **Success:** a `done` frame alone is not success. Success needs a complete result **and** a zero exit status. A nonzero exit, a signal, a forced kill, a frame after the result, or an incomplete stream each settle as a failure that is never retained as checked and never indexed.
- **Removed:** the separate 5-second post-result wait.

Kill and reap happen in the same loop, so every settlement fits the pre-registered "deadline + 500 ms". The suite's R2 cases use a 300 ms deadline and settle in at most 302.7 ms. Cancellation, supersession, owned-scratch cleanup, the identity checks and outcome-code privacy are unchanged; all their original cases still pass.

## R3: fail-closed runner

`run-phase2.py`:
- **Locations:** refuses scratch/output locations that already exist, overlap, sit inside the repository or contain it. Scratch is removed only after a fully valid run, and only when this runner's own ownership marker is present.
- **Gates:** requires a clean build and a fully passing suite before measuring.
- **Extraction checks:** for every extraction run it checks the inner worker's own exit (passed through by `time -l`), that a final `done/checked` frame arrived, and that the exact expected number of text pages came back. It also checks the 15 spawn-to-first-frame workers, the IPC fields and the RSS.
- **Index checks:** for every index run it checks the exit, the RSS, the record count, all six queries with 15 samples each, and a `Ready` reopen.
- **Exit codes:** a failure exits 2/3/4/5 with the stage and reason in `summary.json`, and keeps all receipts and scratch.
- **Preservation:** compares a SHA-256 for every tracked and untracked, non-ignored file before and after, plus `git status`. An already-dirty file whose bytes change again is caught even when its status line does not change.
- **Temporary example:** removed only if it still holds this runner's exact bytes. If someone else changed it, it is left in place and the run fails.
- **Target misses:** a valid run with misses exits 0 and lists them. **Invalid measurement and budget miss are separate outcomes.**

**Regressions:** `test_run_phase2.py` has 13 cases.
- **Cases:** nonzero extraction, nonzero index, failed inner worker, wrong text-page count, missing RSS, missing field, failed suite (nothing measured), changed status, already-dirty file changed again, example changed by another writer, overlapping locations, output inside the repository, and normal success.
- **Corrected runner:** 13/13 pass.
- **Submitted runner:** 11 fail and 2 error. The two errors are `KeyError`/`TypeError` crashes instead of a clean invalid result.
- **Contract-only differences:** the failed-suite case already stopped measurements before the fix but exited 1, not the new code 3. The normal-success case fails only because the success line changed from PASS to VALID.

## R4: caller input boundary

- **Before spawning:** `Supervisor::start` checks the input size and refuses an over-limit file without creating a worker.
- **Bounded hashing:** caller-side hashing (`bounded_hash`) at request time and at publication refuses a file already over the limit before reading it. Otherwise it reads through one 64 KiB buffer and `take(limit + 1)`, refusing growth once `limit + 1` bytes have arrived. The caller never holds a whole file.
- **Worker check kept:** the worker's own `take(limit + 1)` check and exact-byte hash binding are unchanged and still independently tested.

**Cases** (small injected limits, modest files, no OOM):
- **Initial over-limit:** 3,315 B against a 1,024 B limit is refused with 0 workers.
- **Exact boundary:** at a 3,315 B limit, the file is checked and published, with 3,315 caller bytes read.
- **Growth between check and read:** refused after exactly 3,316 bytes.
- **Worker's own check:** still refuses independently.
- **Oversized publication replacement:** a 2 MiB replacement against a 64 KiB limit is refused with 0 bytes read and no indexing.

**Corrected wording:** the caller boundary is now a hard read bound for the caller's own hashing. It is still not a bound on the worker's parsing memory: page and total output checks remain post-allocation, and the memory watchdog remains sampled.

## Verification

| Check | Result |
| --- | --- |
| Corrected suite (`final/runner/suite.json`) | **71/71**, exit 0: 62 retained original cases, 5 R4 cases (one replaces the original over-limit case) and 4 R2 cases. 30 workers, none left alive or unreaped |
| Fault driver on the corrected binary | 4/4 modes settle by themselves; no external kill |
| Runner regressions | 13/13 corrected; 11 fail and 2 error on submitted |
| Corrected end-to-end run | Exit 0, VALID, preservation clean (5,727 files) |

## Measurements

These ran only after the suite passed, with the same pre-registered datasets, seeds, repeats and targets. Debug build; the load average was 4.9 at the start. **8 of 10 targets met, unchanged from the original run.** The same two **misses** remain and are not adjusted:

| Missed target | Corrected run | Original run | Target |
| --- | ---: | ---: | ---: |
| Warm query p95 at 10,000 | 61.9 ms | 61.8 ms | 50 ms |
| Whole-process peak RSS, 10,000 index run | 285.0 MiB | 284.9 MiB | 256 MiB |

The other values match the original within noise. For example, cold index at 10,000 was 1,753 ms against 1,749 ms.

The RSS watchdog overshoot in this run was 20 MiB (544 MiB peak). Across the three recorded runs it is now **20–270 MiB**. It is still a sampled kill, **not a memory cap**. `ulimit -v` is still refused on this macOS lane.

## Still open (unchanged by this package)

- No hard worker memory cap.
- No real handbook or CID/complex-font/Unicode fixtures.
- No release-build or native painted measurements.
- The owner decisions: memory-isolation option, folding gaps (ß, CJK), prefix opt-in, browser behavior and engine adoption.

**Reproduce:**

```bash
python3 docs/evidence/p54-02-phase2-corrections-2026-10-17/run-phase2.py \
  --repo /absolute/path/to/repo \
  --scratch /new/path/outside/repo --out /another/new/path/outside/repo
python3 -I docs/evidence/p54-02-phase2-corrections-2026-10-17/test_run_phase2.py
```

**Not done here:** this branch was not merged with current main. Under the owner's instruction, Codex performs all merging and integration. No app launch, profile/key, provider, installer, signing or release operation occurred.
