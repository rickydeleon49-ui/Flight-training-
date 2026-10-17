# P54-02 phase 2 final corrections (P54P2-R5–R6): evidence

All paths are relative to this directory.
- `SHA256SUMS` covers every file here except itself and `git-blob-verification.json`.
- `inventory.json` lists the same members with byte counts, SHA-256 and role.
- `git-blob-verification.json` is written after staging, and is outside `SHA256SUMS` because it attests to it. It records each `SHA256SUMS` member's hash as read from its **Git index blob**.

The earlier directories `../p54-02-worker-proof-2026-10-16/` and `../p54-02-phase2-corrections-2026-10-17/` are unchanged.

## Sources (this round's versions)

- `p54_worker_proof.rs` (sha256 `94ca78ed…`): the R2–R4 proof plus R5.
  - The reader sends exactly one terminal message per stream. `eof` is sent only for a clean, fully framed end; a partial final frame or a read error is a refusal.
  - `settle` succeeds only after exit 0 **and** that clean terminal message, so queued trailing frames or refusals are read and judged first.
  - Test-only additions: worker modes `trailing-frame`, `trailing-invalid`, `trailing-partial` and `trailing-oversized`, an `observe_exit` schedule, and a `trailing-case` driver entry.
- `run-phase2.py`: the R3 runner plus R6.
  - The source bytes are captured once.
  - The temporary example is created exclusively and removed only if it still holds those captured bytes.
  - The captured hash is recorded as the built input. A source change during the build fails preservation.
- `test_run_phase2.py`: 17 runner regressions, the 13 from before plus 4 for R6.
- `worker-fault-driver.py`: byte-identical to the previous round's copy.

## `baseline/`: reproductions on the reviewed head 06f4bf3, before any fix

- `trailing-stream-baseline.json`: the re-review's `trailing-stream-adapters.rs` appended to the 06f4bf3 proof (`*-build.log/.exit` record that build). Trailing frame, trailing invalid JSON and trailing partial frame each came out `checked`, `Ok(())`, `indexed: 1`. The normal control also indexed. No external safety kill was needed.
- `cleanup-ownership-baseline.json`: the re-review's `cleanup-ownership-diagnostic.py` run on the 06f4bf3 package. Result: exit 0, `exampleLeft: false`, which means the other writer's example was deleted.
- `runner-regressions-on-06f4bf3.log/.exit`: the 17 runner regressions run against the 06f4bf3 runner.
  - The source-plus-example and source-only cases **fail**.
  - The captured-identity success case **errors**, because no build hash is recorded.
  - The remaining 14 pass.
  - The pre-existing-example case passes on both versions: its injected example appears before the old `exists()` check, so it cannot show the gap between that check and the write.

## `final/`: corrected

- `trailing-stream-final.json`: the same schedule on the corrected binary.
  - The three corrupt streams fail as `frame_after_result`, `malformed_json` and `partial_frame`, with `indexed: 0`.
  - The normal control indexes once.
  - No safety kill was needed.
- `worker-fault-final.json`: the R2 fault cases are unchanged (eof-stall, done-nonzero, done-stall and normal).
- `runner-regressions.log/.exit`: 17/17 pass, exit 0.
- `runner/`: the complete end-to-end run: build, suite 77/77, measurements and summary. Exit 0.
- `runner-console.log`: the runner's console output.
