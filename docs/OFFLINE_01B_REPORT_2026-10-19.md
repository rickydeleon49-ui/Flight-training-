# OFFLINE-01b: honest readiness in the UI — 19 October 2026

**Status: implemented and dormant; Codex round-1 corrections applied, pending re-review.**

This slice builds the proposal's §4.4 readiness wording into the Study Library and the material page, with **Prepare for offline study**. Existing metadata search is unchanged.

## Dormant until the cap is accepted

Codex rejected the worker's memory cap for release, pending pressure testing on dedicated minimum-spec Macs (OFFLINE-01c report §6). So the feature is off in releases on **both** sides:

- **Native:** `prepare_offline_content` returns `offline_extraction_disabled` unless the build is a debug build or was compiled with `HFD_OFFLINE_EXTRACTION=1`. `extraction_enabled()` lives in `extraction/service.rs` and has its own test.
- **UI:** the panel and the library badges render nothing, and make no request, unless the desktop build was compiled with `VITE_OFFLINE_EXTRACTION=1`.
- **Guard:** `src/services/offlineContent.test.ts` fails if any workflow, `package.json`, the Vite or Tauri config, `build.rs` or `scripts/release.sh` mentions either flag. It also checks that the feature is off in tests and browser mode.

Switching it on later is a deliberate, reviewed change.

## What she sees (when enabled)

`src/logic/offlineReadiness.ts` turns each state into a short badge label and one or two plain sentences:

| State | Badge | Detail |
| --- | --- | --- |
| Not prepared | Not prepared | Not ready for offline search yet. Preparing reads the text on your Mac; nothing is sent anywhere. **[Prepare for offline study]** |
| Checking / Preparing | Checking… / Preparing search | Re-checked every 1.5 s until settled |
| Searchable | Searchable | Ready for offline search: all N pages. |
| Partly, images only | Partly searchable | Ready for offline search on S of N pages. K pages are images; text recognition would be needed to search them. |
| Partly, anything else | Partly searchable | Ready for offline search on S of N pages. Some pages couldn't be read. |
| Missing | File missing | This file isn't on this Mac right now, so it can't be prepared. |
| Could not prepare | Could not prepare | A plain reason for known refusals (password-protected, not a complete PDF, too large, too much memory, too much text); otherwise generic. A code is never shown. |

The wording rules from §4.4:
- The specific image reason is used **only** when every unsearchable page is an image.
- Nothing is ever called "scanned".
- An unknown cause gets neutral wording, never a guess.

**Run that stops short:** a timeout or a worker failure that is worth retrying isn't cached, so the state goes from "preparing" back to "not prepared". The panel says "Preparing didn't finish this time. You can try again." rather than silently offering the button again.

**Library:** the PDFs on screen get one readiness request per change of the shown set. "Checking" and "not a PDF" show no badge, so the cards stay quiet.

## Review round 1 corrections (Codex RED)

**1. High: worker mode bypassed the release gate.** Only the Tauri command was gated. `main.rs` dispatched `--hfd-extract-worker` straight into extraction, so a release executable handed a valid request on stdin would extract.

The receipt `receipts/release-worker-refuses-before-fix.log` (exit 101) shows a release worker exiting `0` where `69` was expected.

**Correction:**
- `extraction_enabled()` now lives in `worker.rs` and is checked by worker dispatch itself, after argument validation and before any request is read. A build without the opt-in exits `EXIT_DISABLED` (69) with no output.
- The service re-exports the same function, so there is one gate for both paths.

**Tests:**
- unit test `a_build_without_the_opt_in_refuses_worker_mode_before_reading_anything`;
- release-only integration test `a_release_build_without_the_opt_in_refuses_a_valid_request`, which runs the real release binary with a valid request: no frames, exit 69. Receipt: `receipts/release-worker-refuses.log`.

**Consequence for evidence:** reproducing the OFFLINE-01c release measurements now needs a release build compiled with `HFD_OFFLINE_EXTRACTION=1`. That is deliberate.

**2. Medium: a replaced file kept the old file's readiness.** Restoring or reattaching a file keeps the material's id, and the panel and badges were keyed by id only.

**Correction:**
- `fileIdentity()` combines the id, path, size and `updatedAt`.
- The panel resets to nothing when the identity changes, asks again, and uses an answer, whether from a readiness check or from Prepare, only if it was asked about the file still shown.
- The badges key their request by the shown files' identities, clear at once on a change, and ignore late answers.

**Tests:** three delayed-answer replacement regressions, for the panel (late answer, settled state) and the badges. They fail on the previous UI (`receipts/file-replacement-before-fix.log`, 3 failed) and pass now.

## Tests

- `offlineReadiness.test.ts` (8): exact counts, singulars, image versus neutral wording, no "scan", preparation offered only when not prepared, privacy of unknown codes.
- `OfflineStudyPanel.test.ts` (12):
  - dormant renders nothing and makes no request;
  - not a PDF;
  - prepare flow;
  - re-checking until settled, then stopping;
  - neutral partial wording;
  - a run that stops short;
  - a start failure shown without its code;
  - library badges: one request, PDFs only, quiet states hidden, dormant;
  - file replacement under the same material, for both panel and badges.
- `offlineContent.test.ts` (9): the dormancy guards.
- Native: `debug_builds_may_extract_and_release_builds_need_the_opt_in`, the worker-dispatch refusal test, and the release-only binary refusal test.

**Gate** (receipts in `docs/evidence/offline-01b-2026-10-19/receipts/`): 3,728 frontend tests and 775 native tests pass; typecheck, build, fmt, strict clippy and cargo-lock pass.

**Not verified here:** the painted UI. Browser mode has no native side, so the panel can't render there. A visual check belongs with installed acceptance when the feature is enabled.
