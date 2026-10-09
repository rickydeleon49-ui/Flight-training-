# Mac schema‑13 installed verification — 8 October 2026

Following `docs/MAC_SCHEMA13_VERIFICATION_PROMPT_2026-10-08.md`.

## Status summary
- **Merge + workspace confirmed.** PR #125 MERGED (merge commit `36a7b39`; required `Checks / Tests,
  types, and the data‑safety guards` workflow **SUCCESS**, not bypassed); primary
  `/Users/rickymac/code/Flight-training-` clean, fast‑forwarded `2a6a415 → 36a7b39`, `main ==
  origin/main`, clean; no competing changes on main; archival preservation branches untouched.
- **Prerequisite gate — initially BLOCKED, then authorized by the owner in this session.** The read‑only
  preflight at `36a7b39` first reported `P-TEST-ACCOUNT` / `P-SIGNING` = `USER_ACTION`, `0` code‑signing
  identities, installed smoke `0/8`. The owner then explicitly approved (a) `hfdtest` as the isolated
  standard (non‑admin) test lane and (b) a **fresh local UNSIGNED candidate** built from `36a7b39`.
- **Candidate + fixtures physically built and verified read‑only (this run).** See below.
- **G1 / G2 / G3 — PREPARED, NOT EXECUTED, NOT PASS, NOT SIMULATED.** They require a person to install
  and launch in the `hfdtest` GUI session and record observables/screenshots (the preflight itself
  cannot prove isolation or observe the desktop). I did **not** forge the schema‑12 library by script —
  the prompt requires the installed app to create/upgrade it — so the runbook has the operator populate
  it through the older candidate.

## What was actually done and verified this run (read‑only / local; nothing published)
- Built two local UNSIGNED `aarch64` candidates (`tauri build --bundles dmg --target aarch64-apple-darwin`,
  **SDK pinned to MacOSX26.5** because the default 27.0 is a recorded linker failure). Both `exit 0`.
- Verified the packaged candidates **without launching** (mount read‑only → `codesign`/`plutil`/`lipo` →
  preflight `--app` → detach):

  | | NEW (schema 13) | OLD (schema 12) |
  | --- | --- | --- |
  | source commit | `36a7b39` (ancestor `2a6a415` → head confirmed) | `2a6a415` (migrations 0001–0012 only) |
  | dmg sha256 | `6aecab8608224f9e3f272dff1b8ace4f23d699566329ef1d24e5ab95bb1b0c99` | `455eb12d3f906fd60cef529e2aca464c98ae81e36e48c62d8afd73a092681fcd` |
  | inner exe sha256 | `9c7056c3435b526eff8281d9dbb14daf570983024116a368d6d9d81b61022a2b` | `efc33cb8fa5e7f1916cda3ca957fca80e328030361fc0e714bdb8333a7d72527` |
  | arch / id / version / minOS | arm64 / com.herflightdeck.app / 0.5.3 / 12.0 | arm64 / com.herflightdeck.app / 0.5.3 |
  | codesign | `Signature=adhoc`, `TeamIdentifier=not set`, flags `(adhoc,linker-signed)`, no hardened runtime | `Signature=adhoc`, `TeamIdentifier=not set` |
  | preflight `--app` | display observed/adhoc; **integrity: failed**; stapler: not stapled; spctl: rejected/unknown | same: adhoc; integrity: failed; not notarized |

  Both are **local unsigned / ad‑hoc builds — not Developer ID signed, not notarized, not publicly
  distributable**, exactly as labeled. The frozen historical v0.5.3 installer was **not** reused or
  replaced (these are freshly built DMGs, no tag, no publication).

- Regenerated the three synthetic PDF fixtures on this Mac; **all three SHA‑256 match** `MAC_PARITY_CHECKLIST`
  §4 (A 10p `f6c593f9…`, B 1,050p `0ba9a7e2…`, C 60p `b5651eb6…`).
- Staged both DMGs at `/Users/rickymac/code/.qwen/tmp/schema13-candidates/` for the operator to copy into
  `hfdtest`. Everyday profile untouched (`~/Library/Application Support/com.herflightdeck.app` not present
  here and never opened); no production library redirected; no env‑var guessing.

## The three physical gates — awaiting the in‑session human run
Executed per `docs/evidence/mac-schema13-verification-2026-10-08/RUNBOOK-G1-G3.md` (candidate hashes +
`shasum` verify, fixture hashes, nested **parent 20–40 ⇒ original 120–140 / child count 21**, cancel +
failed‑save reconcile‑then‑cancel recovery, restart with no duplicated parts, schema‑12→13 upgrade with
before/after history‑table hashes equal, older‑binary refusal of a schema‑13 backup that leaves its
library unchanged).

- **G1 Installed Apple Silicon smoke — PREPARED / UNVERIFIED.**
- **G2 Upgrade over populated schema‑12 (installed app) — PREPARED / UNVERIFIED.**
- **G3 Older‑backup restore + newer‑binary refusal — PREPARED / UNVERIFIED.**

Source‑level coverage for the same behaviours (schema‑13 restore validators as true twins, the populated
schema‑12 upgrade test, the older‑binary `newer database format` refusal) is accepted and green, but per
the prompt a source acceptance does not make the physical installed checks pass, and I will not mark
skipped checks as pass.

## What remains for the owner
1. A person logs into the approved `hfdtest` standard account, installs the NEW candidate (right‑click ▸
   Open, since it is unsigned), and records G1–G3 observables + screenshots into the runbook; then
   optionally deletes the whole test account. This is the only step not automatable from this headless
   admin context, and I will not run GUI flows in the everyday admin session.
2. Keep the release track separate: this lane is **local unsigned only**. A Developer ID / notarized,
   publicly distributable candidate still needs Apple Developer Program membership + credentials + the CI
   `macos-signing` or reviewed local lane + a new release version beyond `0.5.3`. None of that was done.

Safety: read‑only inspection plus local builds only. No signing, notarization, keychain change, Gatekeeper
change, CI trigger, provider call, install into the everyday profile, or publication. Report + evidence
left **uncommitted/unpushed for senior review**.

Evidence: `docs/evidence/mac-schema13-verification-2026-10-08/` — `README.md`, `RUNBOOK-G1-G3.md`,
`receipts/{readiness-preflight.json,readiness-preflight.txt,prerequisite-audit.txt,candidate-identity.txt,build-new-schema13.log,build-old-schema12.log}`, `SHA256SUMS`.
