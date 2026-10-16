# Independent M4/release review evidence — 16 October 2026

Read [the review](../../M4_RELEASE_INDEPENDENT_REVIEW_2026-10-16.md) and [one correction prompt](../../M4_RELEASE_REVIEW_CORRECTIONS_PROMPT_2026-10-16.md).

The frozen `submitted-pack/` contains exact reviewed controller, persistence, contract, candidate DDL and shared checker bytes. No candidate migration is registered or executed against an app profile.

```sh
node --test --test-reporter=tap docs/evidence/m4-round4-independent-review-2026-10-16/remaining-diagnostics.test.mjs
M4_REVIEW_TARGET_PACK=/absolute/path/to/corrected/evidence/pack node --test --test-reporter=tap docs/evidence/m4-round4-independent-review-2026-10-16/remaining-diagnostics.test.mjs
```

Baseline is0 passed/4 failed by assertions on both Node22.23.3 and26.10.0. The public diagnostic changes only fixture-path binding from the first local run; its assertions are unchanged. `reviewed-input-hashes.json` seals the live submitted pack/report, and the independent SHA256SUMS seals this review delivery.

`replay.json`, runtime-specific logs and `node22-baseline-receipts/` / `node26-baseline-receipts/` preserve the successful72-case/16-mutant full replays. `replay.py` documents disposable clone setup and actual npm10 install; its absolute paths are the review machine's scratch paths. It never builds the app. The historical five diagnostics pass on each lane.

`full-runner-probes.json` and the saved actual audits show both failed-install-metadata reuse and the invented active mutant still produce successful real-runner outcomes. To reproduce, use a prepared disposable clone with the engine installed; never modify the submitted/live pack. For reuse, preserve digests but give scratch-artifacts a failed-install command, installExit42 and a nonexistent install cwd, then run the real reuse route. For the mutant, restore that file and append only `Current executed mutant: M99_NAVIGATION_NEVER_EXECUTED` to the current round4 report; the current runner still exits0. Both need real rejection tests after correction. The initial probe recorder looked for the wrong08b receipt basename after both runs completed; the actual receipt was copied without altering or rerunning either result.

`frontend-checks.json` / `gemini-focused.txt` record13 relevant application tests and typecheck. `release-verification.json` records newly downloaded published DMG hashes and matching installed v0.5.5 executable; no installers are included here. `pr178-whitespace.txt` is empty because the reviewed commit's whitespace check succeeded. No native app launch, key access or provider call was performed by this review.

Copied raw receipts retain their original whitespace. Any exact-file attributes apply only to these historical outputs, not application/test source. Original live submissions and historical failures remain untouched.
