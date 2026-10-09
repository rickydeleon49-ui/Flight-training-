# Mac schema‑13 preparation corrections — evidence pack (8 October 2026)

Closes **MACV‑R1, MACV‑R2, MACV‑R3** from `docs/MAC_SCHEMA13_PREPARATION_REVIEW_2026-10-08.md`.
Report: `docs/MAC_SCHEMA13_PREPARATION_CORRECTIONS_2026-10-08.md`.

**Nothing here is an installed result.** The corrected candidates, helper and walkthrough are ready;
G1–G3 remain **UNEXECUTED / UNVERIFIED** until a person runs `RUNBOOK-G1-G3.md` in the `hfdtest` GUI
session. The original failed packages and the submitted 12‑path pack are preserved byte‑for‑byte.

Source of the corrected packages: NEW `36a7b39acd291cba14be4f137798b3ad6f7272f1`, OLD
`2a6a41536b676559db94b476c71dd645af03fbab` (ancestor of NEW). SDK pinned to `MacOSX26.5`;
`--target aarch64-apple-darwin`. **Local ad hoc signed only** — not Developer ID, not notarized, not
publicly distributable.

## Contents (enumerated; the two `.log` receipts are matched by the repo's `*.log` ignore rule and must
be added explicitly — `git add -f` — so publication cannot silently drop them)

| Path | What it is |
| --- | --- |
| `README.md` | this file |
| `RUNBOOK-G1-G3.md` | corrected standalone operator walkthrough (MACV‑R1 + R2) |
| `inspect-adhoc-packages.py` | verification script, mirrors the reviewer's `inspect-packages.py` commands; mounts read‑only under `/tmp`, detaches in all outcomes, never launches the app |
| `SHA256SUMS` | every file in this directory except itself |
| `receipts/package-results.json` | command outcomes + exits for both corrected DMGs |
| `receipts/NEW-schema13-36a7b39-adhoc.dmg.attach.txt` | read‑only mount output |
| `receipts/NEW-schema13-36a7b39-adhoc.dmg.exe-verify.txt` | `codesign --verify --strict --verbose=4` on the executable in its bundle (exit 0) |
| `receipts/NEW-schema13-36a7b39-adhoc.dmg.bundle-verify.txt` | `codesign --verify --deep --strict --verbose=4` on the app (exit 0) |
| `receipts/NEW-schema13-36a7b39-adhoc.dmg.signature.txt` | `codesign -dv --verbose=4` display (adhoc + runtime, sealed resources) |
| `receipts/NEW-schema13-36a7b39-adhoc.dmg.arch.txt` | `lipo -archs` (arm64) |
| `receipts/NEW-schema13-36a7b39-adhoc.dmg.plist.txt` | bundle id `com.herflightdeck.app` |
| `receipts/OLD-schema12-2a6a415-adhoc.dmg.attach.txt` | as above, OLD |
| `receipts/OLD-schema12-2a6a415-adhoc.dmg.exe-verify.txt` | as above, OLD |
| `receipts/OLD-schema12-2a6a415-adhoc.dmg.bundle-verify.txt` | as above, OLD |
| `receipts/OLD-schema12-2a6a415-adhoc.dmg.signature.txt` | as above, OLD |
| `receipts/OLD-schema12-2a6a415-adhoc.dmg.arch.txt` | as above, OLD |
| `receipts/OLD-schema12-2a6a415-adhoc.dmg.plist.txt` | as above, OLD |
| `receipts/rebundle-new.log` | raw `tauri bundle` output for NEW (shows the `codesign --force -s - --options runtime` calls; **ignored by `.gitignore` — add with `-f`**) |
| `receipts/rebundle-old.log` | raw `tauri bundle` output for OLD (**ignored by `.gitignore` — add with `-f`**) |
| `receipts/adhoc-overlay.json` | the exact scoped config overlay (`bundle.macOS.signingIdentity: "-"`) |
| `receipts/helper-self-check.json` | the snapshot helper's 8 isolated checks (control, changed‑history detection, wrong‑root refusal, wrong‑uid refusal, WAL handling, real‑0013 upgrade shape) |
| `receipts/fixture-hashes.txt` | the three synthetic PDF fixtures re‑hashed on this Mac |
| `receipts/originals-preserved.txt` | hashes proving the rejected original DMGs and in‑tree bundle copies are unchanged |

## Candidate identities (corrected packages)
| Role | dmg sha256 | inner exe sha256 (post‑sign) | verification |
| --- | --- | --- | --- |
| NEW schema 13 (`36a7b39`) | `b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334` | `824688939086c16bd5ec8be7312545725d79ce284ebab2fe3ed0d1eaf400eb28` | exe‑verify 0, bundle‑verify 0 |
| OLD schema 12 (`2a6a415`) | `ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62` | `2e44bfbbd1dd65e93697d65ca8b5beff5237173e4dbf8484a89ee21f9c98842a` | exe‑verify 0, bundle‑verify 0 |

Pre‑sign executables were the review's frozen `9c7056c3…` (NEW) and `efc33cb8…` (OLD); signing changes
signature bytes, so the old hashes are **not** reused for these artifacts.

Staging (outside the repo, readable for transfer to `hfdtest`):
`/Users/rickymac/code/.qwen/tmp/schema13-candidates/` — corrected `-adhoc.dmg` files, the rejected
originals, and `original-bundle-artifacts/{NEW,OLD}/` in‑tree copies.
