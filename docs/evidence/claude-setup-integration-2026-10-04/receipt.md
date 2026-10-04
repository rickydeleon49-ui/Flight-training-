# PR #70 setup integration (SETUP-R1–R7): receipt, 4 October 2026

Prepared by Claude on the Mac for Codex review. New local measurements only (Node v22.23.3, npm 10.9.9, macOS on Apple silicon). Earlier results stay where they were: the Mac correction receipt (`../claude-setup-corrections-2026-10-04/receipt.txt`, preserved byte-identical, SHA-256 `014d9735…`) and the cloud results recorded with `98ab90c`.

- Review: <https://github.com/rickydeleon49-ui/Flight-training-/pull/70#pullrequestreview-5404875113>.
- Integration checkout: separate worktree, branch `claude/cool-carson-9wjrub-integration`, based on the PR head `98ab90cb4ec97be1bf231974cc82d838babe6bb0`. Uncommitted and unpushed.

## Both starting versions verified and preserved

| Version | Where | Check |
| --- | --- | --- |
| Local Mac correction (7 files, base `ea18a0e`) | primary checkout, branch `claude/cool-carson-9wjrub`, dirty | 7/7 review hashes match, before and after this work; not switched, reset or edited |
| Pushed correction (8 files) | `origin/claude/cool-carson-9wjrub` = `98ab90c` | 8/8 review hashes match; nothing pushed or rewritten |

## Provenance map

| Area | From pushed `98ab90c` | From local Mac version | New in integration |
| --- | --- | --- | --- |
| Hook path | quoted registered path | quoted path (same) | — |
| Hook budget | 900 s (tied to its cold-container estimate) | (1200 s, not kept) | — |
| npm layout | separate `npm-deps.sh`; `npm ls --all --offline`; `cold`/`warm` messages | marker covers `package-lock.json`, `package.json` and Node major; visible missing-lock failure; `git hash-object` (portable) | — |
| Manifest guards | `package.json` + `package-lock.json` inside `npm-deps.sh` | all four (`package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`) around the whole hook | both kept |
| Screenshot test seams | `HFD_SHOT_PORT/PLAYWRIGHT/SERVER/TIMEOUT_MS` | (`HFD_SCREENSHOT_*`, not kept) | `HFD_SHOT_PROBE_MS`, `HFD_SHOT_GRACE_MS` |
| Cleanup and errors | first error wins; a failed close exits 1 | bounded SIGTERM, then SIGKILL escalation; spawn-error and already-exited handling | cleanup notes for later errors; group exit verified after SIGKILL (R6) |
| Readiness | — | — | every probe cancelled with `AbortController`, capped by the remaining startup time; an initial probe that connects but never answers means "leave it running and stop" (R7) |
| Browser context | fresh `newContext` per run | fresh context (same) | — |
| `CLAUDE.md` | five records, key path, `useModalDialog` fallback, test command | field cleared, MAC-16, allowlist accuracy, hook behavior | fallback coverage stated separately from unverified installed macOS 12.0–12.2 |
| `SKILL.md` | (unchanged from `ea18a0e`) | reuse/cleanup/isolated-context/UI-evidence lines | bounded-wait line |
| Tests | spaced-path hook, unquoted control, npm cold/warm/stale marker/mismatch, screenshot failures by step, reuse | local no-op, plain control, remote spaced reaches setup, changed lock or `package.json` invalidates, damaged cache, missing lock, navigation-plus-close failure, early server exit, reuse after a failure | R5, R6, R7 regressions; four-file guard; watchdog and reviewer-owned cleanup on every screenshot run |

## Findings

| ID | Disposition |
| --- | --- |
| R1 | Kept and merged; fallback coverage separated from installed testing |
| R2 | Kept (both versions agreed) |
| R3 | Kept; cleanup scope covers startup and every browser step |
| R4 | Kept with the stronger warm validation and the four-file guard |
| R5 | Fixed: a failed close exits 1, cleanup continues, the first error is reported |
| R6 | Fixed: bounded SIGTERM, then SIGKILL, then a verified group exit |
| R7 | Fixed: bounded and cancelled probes; the initial "connects but silent" case stops without signalling the external server |

## Commands and results

The suite: `node --test .claude/tests/setup-helpers.test.mjs`, 29 unique checks. Older versions were run from exact scratch copies (`git show 98ab90c:<file>`, and copies of the local files with hashes re-verified) through `HFD_SETUP_UNDER_TEST=<copy>`.

| Run | Exit | Result | Wall time |
| --- | --- | --- | --- |
| integrated, spaced fixture path | 0 | 29/29 | 20 s |
| integrated, plain (`HFD_SETUP_PLAIN_PATH=1`) | 0 | 29/29 | 19 s |
| pushed `98ab90c`, spaced and plain (identical) | 1 | 23/29: fails 8, 12, 13, 24, 25, 26 | 60 s |
| local Mac version, spaced and plain (identical) | 1 | 25/29, 1 skipped (no `npm-deps.sh`): fails 22, 25, 26 | 53 s |

**Failure meanings:**

- **8** (`package.json` change does not invalidate the warm cache), **13** (no `Cargo.lock` guard) and **12** (the pushed version also fails on a missing lock, with `sha256sum: package-lock.json: No such file or directory` instead of the clearer message) are Mac-version strengths the pushed version lacks.
- **22** = R5.
- **24** = R6.
- **25/26** = R7.

**R5–R7 timings** (one run, per-test `duration_ms` including fixture setup; the watchdog is 15 s):

| Check | Integrated | Pushed | Local |
| --- | --- | --- | --- |
| R5 close failure after success | 0.63 s, pass | 0.58 s, pass | 0.79 s, **fail** (exit 0) |
| R5 navigation then close failure | 0.62 s, pass | 0.58 s, pass | 0.78 s, pass |
| R6 owned server ignoring SIGTERM (parent and child) | 1.14 s, pass (500 ms test grace) | **15.2 s, watchdog** | 5.74 s, pass (fixed 5 s grace) |
| R7 owned server never answers | 1.87 s, pass | **15.2 s, watchdog** | **15.2 s, watchdog** |
| R7 pre-existing server never answers | 0.80 s, pass | **15.2 s, watchdog** | **15.2 s, watchdog** |

**Other checks:**

- Syntax: `bash -n` on both hooks, `node --check` on both `.mjs` files; `settings.json` parses. `git diff --check` and `git diff --no-index --check` on untracked files: clean.
- No process from these checks remained afterwards (`pgrep -f hfd-setup`). `pgrep` also listed four `server.mjs` processes belonging to the ChatGPT app's own bundled Node; they are unrelated and were not touched.

## Intermediate failures

1. **Test PATH artifact.** The first comparison failed most pushed R4 checks with exit 127: the test `PATH` omitted `/sbin`, where macOS keeps `sha256sum`. Fixed in the harness (`SYSTEM_PATH`); it was not a pushed-version defect.
2. **Over-strict assertion.** A "last stderr line" assertion wrongly failed the local version, which does preserve the navigation error (Node prints its version banner last). It was replaced by the real requirement: the close error must never become the thrown error.

## Limits

- Mocked Playwright and dummy HTTP servers only. No real Chromium, Vite app, Tauri app, installed macOS or owner data.
- The hook ran real npm only offline against a dependency-free fixture, with mock `cargo`/`pkg-config`. The cloud `apt` step and a real cold Rust compile were not run, so the 900 s budget rests on the pushed version's recorded estimate.
- Application, CI and Rust matrices were not repeated: no application source changed. The application test result from the earlier receipt is unchanged and is not re-claimed here.
- Out of scope: A2, Slice B, MCP, providers and releases.
