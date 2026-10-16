# Fresh local v0.5.4 candidate from e928601 — report and reviewer handoff (15 October 2026)

**BUILT AND VERIFIED WITHIN THE LOCAL LANE; PENDING INDEPENDENT REVIEW.** Claude (`claude-opus-5-5`), per [`MAC_LOCAL_V054_FRESH_CANDIDATE_PROMPT_2026-10-15.md`](MAC_LOCAL_V054_FRESH_CANDIDATE_PROMPT_2026-10-15.md).

- **Candidate:** one private Apple Silicon v0.5.4 test candidate, locally ad-hoc signed.
- **Not done:** no desktop launch, installation, hfdtest, profile or everyday data access, provider call, Developer ID, notarization, Gatekeeper claim, upload or publication.
- **State:** the report and evidence are uncommitted and unpushed on report branch `codex/local-v054-fresh-candidate`.

## Frozen source

| Item | Value |
|---|---|
| Source commit | **`e9286017d3ca8b1faa1c8f5568c708d43e0b3050`** (merged PR #167). It contains PR #169 (`04d1c67`). |
| Source tree | `655ccd11598ab88309eeb1d01ae57feb0b8b0760`, identical to the accepted PR #167 head `10d67359…` |
| Checkout | `/Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training-` |
| State at start | Clean and detached at `e928601`.<br>No tauri, cargo, rustc, hdiutil or vite process was running.<br>The only existing candidate was the `fee7869` one. |
| Versions | All five version files say **0.5.4** (six occurrences).<br>Bundle ID `com.herflightdeck.app`. |
| Toolchain | Node v22.23.3, npm 10.9.9, rustc and cargo 1.99.0 (Homebrew, host `aarch64-apple-darwin`).<br>`SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`, `CARGO_BUILD_JOBS=4`.<br>macOS 27.0.1 (26A434), arm64.<br>No global Xcode or SDK setting was changed. |

The source tree stayed clean through the build and every check, with `git status` empty. Details are in [`source-freeze.json`](evidence/mac-local-v054-fresh-candidate-2026-10-15/source-freeze.json).

## Build (once) and packaging (once)

**Native build.**

```bash
npm run tauri -- build --target aarch64-apple-darwin --bundles app --no-sign --ci
```

- **Result:** exit 0 in 58.9 s. Rust `release` finished in 53.6 s, and the app bundle was written.
- **Log:** stdout and stderr combined, raw, in [`native-build.log`](evidence/mac-local-v054-fresh-candidate-2026-10-15/native-build.log).
- **No DMG this time:** `--bundles app` was chosen deliberately instead of the earlier `app,dmg`. The earlier automatic DMG step stalled for an unexplained reason. This avoids repeating it and avoids stopping processes, and it still uses the existing Tauri command.
- **Replacement confirmed:** before the build, the bundle executable was the `fee7869` raw build (`0eb41b81…`); afterwards it is `051b225d…`.

**Packaging lane.** This repeats the recorded `fee7869` lane, with timeouts and a cleanup step that always runs. Each command's argv, exit code and output are in [`packaging-receipt.json`](evidence/mac-local-v054-fresh-candidate-2026-10-15/packaging-receipt.json).

1. **Raw `--no-sign` bundle checked:** `codesign --verify --deep --strict` exits 1 with `code has no resources but signature indicates they must be present`. This is recorded and expected, as in the earlier report.
2. **Copied and signed:** `ditto` into the new candidate folder, then `codesign --force --sign - --timestamp=none --identifier com.herflightdeck.app` on that **separate staged copy**. The raw build is left intact.
3. **Signed copy verified:** `codesign --verify --deep --strict` exits 0.
4. **ZIP:** `ditto -c -k --sequesterRsrc --keepParent`.
5. **DMG:** `hdiutil create -srcfolder <temp stage> -size 64m -fs HFS+ -volname "Her Flight Deck Local Test" -format UDZO`, with a 180 s timeout. It exited 0 in 4.0 s, with **no stall**.
6. **Image inspected:** `hdiutil attach -readonly -nobrowse -mountpoint <temp>` (exit 0), then `codesign --verify --deep --strict` on the mounted app (exit 0), then `hdiutil detach` (exit 0).
   - **Cleanup:** `hdiutil info` shows no task image, the mount point is gone and the temporary folders are removed.

## Candidate

**Folder:** `/Users/rickymac/code/Flight-training-backups/local-candidates/2026-10-15-v0.5.4-e928601/`. It is new; nothing was overwritten. Its own `ARTIFACT_SHA256SUMS` and a copy of this report are inside.

| Artifact | Identity |
|---|---|
| `Her.Flight.Deck_0.5.4_aarch64_LOCAL_ADHOC.dmg` | 5,090,023 bytes; SHA-256 `7a93541a1fe7c9ccaa540deb8b164ac0ac09da8bc5c33b8ae1fed6755ad499b9` |
| `Her.Flight.Deck_0.5.4_aarch64_LOCAL_ADHOC.app.zip` | 4,833,453 bytes; SHA-256 `068695bf981b6f4d903b10413b9eb8fabdf18cd281480e2f516070b3d0decf47` |
| `Her Flight Deck.app`: final (ad-hoc sealed) executable | SHA-256 `b60d2e6c04fd18ee31d4a8bd6439ed9388039c3c390ff62e09275c1464848822`. The mounted image's executable is identical. |
| Raw build executable (before local sealing) | SHA-256 `051b225d924a2976b5cbf4ab155c9051bbb755f8bd5a8e0c09d6af026e52ef98` |

**Package facts.**

- **Info.plist:** `CFBundleShortVersionString` and `CFBundleVersion` are 0.5.4, the bundle identifier is `com.herflightdeck.app`, and `LSMinimumSystemVersion` is 12.0.
- **Architecture:** `lipo -archs` reports `arm64`, a thin Mach-O.
- **Signature:** `Signature=adhoc`, `flags=0x2(adhoc)`, `TeamIdentifier=not set`, with no secure timestamp. Sealed Resources v2 covers 1 file.
- **Mounted image:** contains exactly `Her Flight Deck.app`.
- **Status:** LOCAL_ADHOC, a private test only. It is not Developer ID signed, not notarized and makes no Gatekeeper claim.

**Preserved:** the earlier `2026-10-15-v0.5.4-fee7869` candidate predates PR #169. It verified 37/37 against its own `ARTIFACT_SHA256SUMS` both before the build and after packaging ([`preserved-artifacts.json`](evidence/mac-local-v054-fresh-candidate-2026-10-15/preserved-artifacts.json)). It was not written, moved or relabelled, and the frozen v0.5.3 installer was not touched.

## Verification

| Check | Ran here? | Result |
|---|---|---|
| `node --test scripts/mac-schema14-profile-snapshot.test.mjs` on the **new** real ARM64 output | yes | **26 passed / 0 failed / 0 skipped**; exit 0 |
| `npm run test:cargo-lock` | yes | exit 0 |
| RUNBOOK §7 component replay of `e928601` (helper only, on pinned baseline `16f9cf3`; **not** current-app verification) | yes | **PASS**:<br>• 12/12 stages;<br>• `dependencyLock` version-only 0.5.3 → 0.5.4;<br>• cleanup exit 0, worktree removed;<br>• source status unchanged.<br>[Receipt](evidence/mac-local-v054-fresh-candidate-2026-10-15/replay-e928601.json) |
| Frontend typecheck and bundle | yes, as Tauri's before-build step | passed (in `native-build.log`) |
| Full frontend suite, typecheck, frontend build | reused | 3,221 passed / 6 skipped; typecheck and build exit 0 ([QA acceptance](MAC_LOCAL_V054_QA_ACCEPTANCE_2026-10-15.md)) on the **identical tree** (PR #167 head). Exact-head CI run 38834876609 passed. |
| Browser functional QA on the built `dist/` (loopback port 19431, fresh disposable context, synthetic data only) | yes | **17 passed / 0 failed** on the first run.<br>0 browser exceptions, 0 HTTP errors, 0 external requests.<br>The preview server stopped afterwards. |

**Browser scenarios.**

- **From the accepted harness (13):**
  - profile without a school or instructor;
  - notes: create, edit, pin, reload; cancel a delete, then delete and undo;
  - a question and answer;
  - a Flight Fund contribution;
  - a zero expense refused, then a valid one updating the balance;
  - a scheduled lesson with an estimate;
  - a quick debrief that adds no flight time;
  - Skills status and confidence;
  - a custom skill created, renamed, retired and restored;
  - no horizontal overflow at 1024×700;
  - storage isolated between fresh contexts;
  - the error/network gate.
- **New PR #169 medical-date flow (4), set up only through the normal Settings and Certificates forms:**
  - the conflict card names both dates. After a reload, nothing has changed: Settings still says 2031-11-30, and the Settings note appears;
  - choosing the record's date (October 31, 2031) updates only Settings;
  - choosing the Settings date (December 31, 2031) updates only the record, which shows "Expires Dec 31, 2031";
  - with the dates matching, no conflict note appears.
- **Not tested in the browser:** pending and retry behaviour, because a browser build can't inject a failing or held write. The real-SQLite regressions accepted in PR #169 cover it.
- **Older impossible flight times:** covered by PR #169's automated tests. Production validation was not weakened to seed them.

The harness is a copy of the accepted one with a new port and output folder; the accepted evidence was not overwritten. It is archived as [`browser-functional-archived.mjs`](evidence/mac-local-v054-fresh-candidate-2026-10-15/browser-functional-archived.mjs). The results, console log and the medical, Finances and Skills screenshots are in [`browser-functional/`](evidence/mac-local-v054-fresh-candidate-2026-10-15/browser-functional/); the overflow screenshot is only in the candidate folder.

## Failures and observations

- **Expected failure:** the only failing command was the raw `--no-sign` bundle's strict signature check, as already documented. The sealed copy passes.
- **No retries:** there was no retried, skipped or weakened check, and nothing was rerun to hide a failure.
- **DMG stall not reproduced:** the automatic Tauri DMG step was not run, by choice, so its original stall is neither reproduced nor explained.
- **Screenshot artifact:** full-page screenshots show the sidebar background ending at the viewport height. This is how the capture renders a fixed sidebar, not a reported app defect.

## UNVERIFIED / deferred

These were not executed: desktop launch; installation; hfdtest or standard-account behaviour; installed upgrade from 0.5.3 and restore; native pickers and PDF workflow; Gatekeeper; VoiceOver; mid-save behaviour; Developer ID signing; notarization; publication.

Older schema 12→13 installed results do not certify this schema-14 candidate. Browser and source checks cannot close installed acceptance.

## Reviewer handoff

- **Report branch:** `codex/local-v054-fresh-candidate` at `e928601`, uncommitted.
  - **New:** this report and `docs/evidence/mac-local-v054-fresh-candidate-2026-10-15/`. The evidence folder includes `README.md`, `evidence-inventory.json` and `SHA256SUMS`.
  - **Modified:** `ROADMAP.md`, `STATUS.md` and `docs/PROJECT_HANDOFF.md`, each with a new top entry; history is kept.
- **Not modified:** historical build and implementation manifests.
- **Tracker side effect:** editing those trackers will, as before, make the schema-14 completion `SHA256SUMS` and the earlier evidence packs' tracker hashes differ from disk. They remain snapshots of their own commits, and no code change is involved.

```bash
cd /Users/rickymac/.codex/worktrees/m2-card-c2-source-rereview/Flight-training-
shasum -a 256 -c docs/evidence/mac-local-v054-fresh-candidate-2026-10-15/SHA256SUMS
cd /Users/rickymac/code/Flight-training-backups/local-candidates/2026-10-15-v0.5.4-e928601 && shasum -a 256 -c ARTIFACT_SHA256SUMS
codesign --verify --deep --strict "Her Flight Deck.app" && codesign -dv "Her Flight Deck.app"
```

Recommended next step: independent review of this report and the candidate identities. After that, the owner decides on desktop launch or installed testing; that decision stays with the owner.
