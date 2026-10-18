# Fresh local v0.5.4 candidate — independent acceptance, 15 October 2026

**ACCEPT within the private local candidate lane. No blocking defect found in this submission.** This accepts the build/package identities and synthetic evidence, not installed or public-release behavior. Report/evidence integration still requires the containing PR's exact-head CI.

## Frozen candidate identity

Built from e9286017d3ca8b1faa1c8f5568c708d43e0b3050, tree655ccd11598ab88309eeb1d01ae57feb0b8b0760 (PR167, including PR169). The native build receipt records the existing Tauri arm64 app-only command, scoped SDK26.5 and Node22, exit0 in58.9seconds. Packaging uses the accepted separate local ad-hoc/ZIP/bounded DMG lane, not a claimed fix of the older automatic DMG stall. The raw unsigned resource-envelope failure is preserved; the separately sealed app passes. The source has no production/version/dependency modification. Existing exact-source frontend/native CI evidence is reused honestly; no redundant full source matrix or native rebuild was run by the reviewer.

| Artifact | SHA256 |
| --- | --- |
| Her.Flight.Deck_0.5.4_aarch64_LOCAL_ADHOC.dmg (5,090,023bytes) | 7a93541a1fe7c9ccaa540deb8b164ac0ac09da8bc5c33b8ae1fed6755ad499b9 |
| Her.Flight.Deck_0.5.4_aarch64_LOCAL_ADHOC.app.zip (4,833,453bytes) | 068695bf981b6f4d903b10413b9eb8fabdf18cd281480e2f516070b3d0decf47 |
| Final app executable, including ZIP and mounted DMG | b60d2e6c04fd18ee31d4a8bd6439ed9388039c3c390ff62e09275c1464848822 |
| Raw app executable before resource sealing | 051b225d924a2976b5cbf4ab155c9051bbb755f8bd5a8e0c09d6af026e52ef98 |

Artifacts remain local in `/Users/rickymac/code/Flight-training-backups/local-candidates/2026-10-15-v0.5.4-e928601/`. No installer/app binary enters Git or is uploaded.

## Independent checks executed

- All21 submitted source/report/evidence hashes and the evidence checksum file matched before editing. The complete21-file submission is preserved in commit8a304ba. Both raw logs are explicitly included despite the repository log ignore rule.
- Candidate ARTIFACT_SHA256SUMS14/14 and earlier fee7869 candidate37/37 matched. Neither candidate or report copy was modified by review.
- App strict/deep resource verification passed; signature reports local ad-hoc and no TeamIdentifier. Architecture arm64; version0.5.4; bundleIDcom.herflightdeck.app; minimumOS12.0. No Developer ID, hardened-runtime/secure-timestamp/notarization or Gatekeeper acceptance is claimed.
- ZIP members have no absolute/traversing paths; the executable matches the staged app and reported final hash.
- The exact DMG was mounted read-only/nobrowse in a disposable directory, its sole top-level app and executable/Info.plist checked, and its strict/deep signature verified. diskutil reports Writable=false, WritableMedia=false, WritableVolume=false. Detach exited0; scoped image inventory confirms no task image remains; mount directory removed. The reviewer initially assumed different diskutil read-only key names; that probe failed at its metadata assertion after package checks had passed and its finally cleanup completed. The corrected observed-key check passed; the initial reviewer mistake is preserved separately, not labelled an app failure.
-26/26 helper tests passed on the newly built ARM64 target, and Cargo-lock check passed.
-17/17 browser scenarios passed independently against the built frontend, in fresh disposable browser contexts with synthetic records. Both medical authority choices and no-change-before-choice passed; zero browser exceptions, HTTP errors or external requests were recorded. Source harness was copied outside the repository with only a fresh port19433/output location; the original evidence was not overwritten. Preview process stopped and port19433 has no listener.
- The medical screenshots were visually inspected; the fixed-sidebar/full-page capture cutoff is not treated as an application defect. Pending/failure/retry are source-level real-SQLite regressions from PR169, not claims from the browser/native package.

[Independent receipts](evidence/mac-local-v054-fresh-candidate-review-2026-10-15/) include actual commands/exits, package checks, browser script/results and the corrected metadata check. Original build/browser/helper/replay receipts remain in the candidate submission evidence. Source tests3,221/6skipped and native CI464/6ignored on the identical accepted source tree were reused, not rerun. No source was changed to produce passing results. Raw stdout retains its own formatting; no all-files whitespace-clean claim is made.

## Report integration and remaining gates

The three mutable trackers change to record this acceptance. Refresh only the schema14 component's current20-file replay inventory so its documented default-current-main recipe remains usable; original build and implementation receipts/manifests retain their frozen provenance. This is a new metadata inventory/component replay, not a native rebuild or relabelling of the candidate's frozen e928601 source. Final exact-head CI, merged identity and replay result are recorded in the containing PR closeout.

Source/version preparation and the fresh local candidate lane are complete. Desktop launch/install, hfdtest/standard-account behavior, populated-data upgrade, older-backup restore, native pickers/PDF flow, Gatekeeper, VoiceOver and public signing/publication remain UNVERIFIED/deferred. Do not start another preparatory audit or launch anything automatically. The next release action awaits the owner's choice to perform installed/use verification; future M4/M5/provider tasks retain their separate scope/approval. The current candidate is a private local ad-hoc test artifact, not public-release acceptance.
