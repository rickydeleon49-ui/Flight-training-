# P54-02 phase 2 final corrections P54P2-R5–R6: report

**Proof and runner corrections only. Pending independent review; no self-merge.** This is not production search and not engine adoption. Claude implemented it on the PR199 branch `claude/p54-02-worker-proof`, on top of the reviewed head 06f4bf3, following the [final correction assignment](P54_02_PHASE2_FINAL_CORRECTIONS_PROMPT_2026-10-17.md).

- **Frozen inputs:** the re-review's five frozen inputs verified against 06f4bf3 before any edit.
- **Unchanged:** the pre-registration, the original proof directory and the R1–R4 correction directory.
- **New sources and receipts:** [`evidence/p54-02-phase2-final-corrections-2026-10-17/`](evidence/p54-02-phase2-final-corrections-2026-10-17/README.md).
- **No application change:** the runner compared 5,786 files by content and found none changed.

## R5/R6 to tests

| Finding | Baseline on 06f4bf3 | Fix | Permanent tests (final) |
| --- | --- | --- | --- |
| **R5** trailing frame / invalid JSON / partial frame after a complete result, worker already exited 0 | All three `checked`, `indexed: 1` | One terminal reader message: `eof` only for a clean, fully framed end. Partial final frame → `partial_frame`; read error → `read_error`. `settle` needs exit 0 **and** clean `eof` before success; queued trailing frames or refusals are consumed and judged first. A reader that disconnects without a terminal message → `reader_gone`. Deadline unchanged; no blocking wait | 4 suite cases: trailing frame, invalid JSON, partial frame, oversized trailing line. Each is a failure, with nothing checked retained or indexed. An already-exited normal control is checked and indexed once. A direct reader case covers clean `eof`, partial and read error |
| **R6** source and example both changed to matching new bytes during the build | Example deleted, exit 0 | Source bytes captured once. Example created exclusively (`xb`), so an intervening writer is never overwritten. Cleanup compares with the captured bytes, never the current source. The captured hash is recorded as the built input. A source change during the build is a preservation failure | 4 new runner cases: source-only edit, source-plus-example edit, an example appearing before creation, and captured identity on success. These join the existing example-only and success cases |

**Coverage of the new runner tests on 06f4bf3.**
- **Fail as expected:** source-plus-example and source-only edits fail.
- **Contract difference:** the captured-identity success case errors because no build hash was recorded.
- **Not shown by this test:** the appearing-example case passes on both versions, because its injected example lands before the old `exists()` check. The narrower check-then-write race is closed by exclusive creation, not demonstrated by this test.

All earlier gates still pass:
- **R2:** EOF-alive, done/nonzero and done/stall settle by themselves; the normal control is unchanged.
- **R3:** measurement, suite, preservation, location and example-only cleanup gates.
- **R4:** the caller input boundaries.
- **Other:** cancellation, supersession, privacy and cleanup.

## Verification

| Check | Result |
| --- | --- |
| Corrected suite | **77/77**, exit 0: the 71 previous cases plus 6 R5 cases |
| R5 schedule driver (corrected) | 3 failures with `indexed: 0`; the control indexes once; no external kill |
| R2 fault driver (corrected) | Unchanged results; no external kill |
| Runner regressions | 17/17 corrected; on 06f4bf3, 2 fail and 1 errors |
| End-to-end run | Exit 0, VALID; build hash `94ca78ed…` captured; preservation clean |

## Measurements (only after all gates passed)

Same pre-registered datasets, seeds, repeats and targets; debug build. **8 of 10 targets met, unchanged.** The two misses remain and are not adjusted:

| Missed target | This run | Target |
| --- | ---: | ---: |
| Warm query p95 at 10,000 | 61.2 ms | 50 ms |
| Whole-process peak RSS, 10,000 index run | 284.7 MiB | 256 MiB |

The RSS watchdog overshot by 248 MiB this run; the recorded range is 20–270 MiB. It remains a sampled kill, not a memory cap.

## Still open

- No hard worker memory cap.
- No real handbook or CID/complex-font/Unicode fixtures.
- No release-build or native painted measurements.
- The owner adoption decisions.

PR199 is still based on d080efa. Reconciling it with current main, and the exact-head CI that follows, are Codex's integration steps.

**Reproduce:**
```bash
python3 docs/evidence/p54-02-phase2-final-corrections-2026-10-17/run-phase2.py \
  --repo /absolute/path/to/repo --scratch /new/path/outside/repo --out /another/new/path/outside/repo
python3 -I docs/evidence/p54-02-phase2-final-corrections-2026-10-17/test_run_phase2.py
```

No app launch, profile/key, provider, installer, signing or release operation occurred.
