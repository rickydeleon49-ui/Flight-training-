# Mac schema‑13 installed verification — evidence pack (8 October 2026)

For `docs/MAC_SCHEMA13_VERIFICATION_PROMPT_2026-10-08.md`. Report:
`docs/MAC_SCHEMA13_VERIFICATION_2026-10-08.md`.

**Outcome:** merge + workspace confirmed; owner authorized the isolated lane (`hfdtest`, standard
non‑admin) + a fresh **local unsigned** candidate; both candidates built from the exact commits and
verified **read‑only without launching**; fixtures regenerated with matching hashes; **G1–G3 prepared
but UNEXECUTED** (require a person to install/launch in the `hfdtest` GUI session — not run, not
simulated, not marked pass). Nothing signed, notarized, published, or installed into the everyday profile.

Source identity: PR #125 MERGED; merged commit `36a7b39acd291cba14be4f137798b3ad6f7272f1`; primary
`/Users/rickymac/code/Flight-training-` clean `main == origin/main` after fast‑forward `2a6a415 → 36a7b39`.

## Contents
- `README.md` — this file.
- `RUNBOOK-G1-G3.md` — the in‑session operator runbook (candidate hashes to verify, fixtures, nested
  parent 20–40 ⇒ original 120–140 / child count 21, cancel + failed‑save recovery, schema‑12→13 upgrade
  with before/after history hashes, older‑binary refusal of a schema‑13 backup).
- `receipts/readiness-preflight.json` / `.txt` — read‑only preflight at `36a7b39`
  (`hfd-mac-readiness-preflight/2`, exit 0, `readyForInstalledUse:false`); `P-TEST-ACCOUNT`/`P-SIGNING`
  `USER_ACTION`, installed smoke `0/8`, host Apple M5 arm64.
- `receipts/prerequisite-audit.txt` — `0` code‑signing identities; `hfdtest` non‑admin; everyday data
  absent; no candidate bundle before the builds.
- `receipts/candidate-identity.txt` — NEW/OLD candidate dmg + inner‑exe SHA‑256, arch/id/version,
  adhoc signature + preflight `--app` integrity‑failed/not‑stapled observations, SDK 26.5 pin, and the
  fixture hashes.
- `receipts/build-new-schema13.log` / `build-old-schema12.log` — raw `tauri build` output (exit 0 each).
- `SHA256SUMS` — this directory, excluding itself.

## Candidates (LOCAL UNSIGNED / ad hoc — not Developer ID, not notarized, not distributable)
Staged for the operator at `/Users/rickymac/code/.qwen/tmp/schema13-candidates/`:
- `NEW-schema13-36a7b39.dmg` (source `36a7b39`, schema 13).
- `OLD-schema12-2a6a415.dmg` (source `2a6a415`, schema 12; used to create the populated profile and the
  older backup, and as the older binary that must refuse a schema‑13 backup).
Builds pinned SDK `MacOSX26.5` (default 27.0 is a recorded linker failure). The frozen v0.5.3 installer
was not reused or replaced; no tag/publish.

## Remaining owner action
A person executes `RUNBOOK-G1-G3.md` in the `hfdtest` session and records observables/screenshots;
that is the only step not automatable from this headless admin context. Developer ID / notarized /
public distribution and a release version beyond `0.5.3` remain separate, unauthorized release decisions.
