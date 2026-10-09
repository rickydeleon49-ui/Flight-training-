# Mac schema‑13 preparation corrections — 8 October 2026

Closes **MACV‑R1, MACV‑R2 and MACV‑R3 together** from
`docs/MAC_SCHEMA13_PREPARATION_REVIEW_2026-10-08.md`. The accepted split‑lineage source, PR #125 and
the scope/acceptance chain are **not** reopened, and no application behaviour, schema or provider path
was changed. **G1–G3 remain UNEXECUTED / UNVERIFIED** — they need a person in the `hfdtest` GUI
session. Nothing was published, pushed, committed, signed with a Developer ID, notarized or installed
into the everyday account.

## Starting state, verified before editing
- Read the review, its pack/manifest, the unchanged submitted report + eight‑entry manifest, the
  original verification prompt, the split‑lineage acceptance/integration reports and current
  STATUS/handoff. The review and corrections prompt were read from `origin/main` (`21581fc`, PR #126)
  with `git show`; **the dirty primary was not pulled, checked out, reset or stashed over.**
- Primary `/Users/rickymac/code/Flight-training-`: HEAD `36a7b39`, the submitted work still present as
  2 modified + 2 untracked paths, nothing staged.
- **All 12 frozen submitted hashes and all 13 source anchors from the review pack verified against the
  working tree: 25/25 match**, so the originals are intact and there were **no competing changes** to
  report before editing.
- Archival checkouts untouched (`staged=0 modified=0` each); reuse of the recorded owner approvals only
  (`hfdtest` UID 502 standard/non‑admin, synthetic disposable data, fresh local unsigned/ad hoc
  candidates) — no new approval sought, no everyday‑account use, no provider call, no Developer ID
  provisioning, no notarization, no publication, no v0.5.3 replacement.

## MACV‑R3 — bundle integrity resolved (P1)
**Diagnosis, separate from the missing Developer ID/notarization:** the shipped bundles carried only the
**linker's** ad hoc signature — `flags=0x20002(adhoc,linker-signed)`, `Info.plist=not bound`,
`Sealed Resources=none`, bundle id recorded as the pseudo `her_flight_deck-ab230c473fe96d5f`. That
signature form asserts resources exist yet seals none, so both `codesign --verify --strict` on the
executable in its bundle and `--verify --deep --strict` on the app exited 1
("code has no resources but signature indicates they must be present"). Hash equality had proved
identity only, never integrity.

**Correction (no source change, no rebuild, no tracked release config change):** rebundled the
**existing verified build products** with Tauri's documented ad hoc pseudo‑identity through a scoped
`--config` overlay (`receipts/adhoc-overlay.json`), which makes Tauri run
`codesign --force -s - --options runtime` on the executable and then the app:
```
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
npx tauri bundle --bundles dmg --target aarch64-apple-darwin --config adhoc-overlay.json --ci
```
Chosen after inspecting the installed tooling: `@tauri-apps/cli` 2.11.4 exposes a dedicated `bundle`
command ("already built by `tauri build`"), so a rebuild was unnecessary; both original executables
still matched their recorded hashes on disk (`9c7056c3…` NEW, `efc33cb8…` OLD). SDK 26.5 pin retained
(default 27.0 is the recorded linker failure). `--skip-stapling` was irrelevant (no notarization
attempted, none possible).

| | dmg sha256 | inner exe sha256 | exe‑verify | deep bundle‑verify |
| --- | --- | --- | --- | --- |
| NEW `36a7b39` | `b3ead8139049d2fe829469744ff5a3394e145a3cb0ad09d8ca5ac9ae9f65f334` | `824688939086c16bd5ec8be7312545725d79ce284ebab2fe3ed0d1eaf400eb28` (was `9c7056c3…`) | **exit 0** | **exit 0** |
| OLD `2a6a415` | `ddb0594e351e0cd90a9fd0ede4824c1fd6fe3cb043d523a31939988fc0077c62` | `2e44bfbbd1dd65e93697d65ca8b5beff5237173e4dbf8484a89ee21f9c98842a` (was `efc33cb8…`) | **exit 0** | **exit 0** |

Both now report `flags=0x10002(adhoc,runtime)`, `Sealed Resources version=2 rules=13 files=1`,
`Info.plist` bound, bundle id `com.herflightdeck.app`, `lipo` arm64 — verified by re‑mounting each final
DMG read‑only through `inspect-adhoc-packages.py`, which mirrors the reviewer's own command set and
detaches in all outcomes. Signature bytes changed, so **the old identity hashes are not reused**.
Still explicitly absent: Developer ID authority, team id, hardened‑runtime trust path, stapled ticket —
`spctl --assess --type execute` still returns **rejected** and `stapler validate` reports no ticket, so
these remain **local ad hoc / behaviour‑only** artifacts, never distributable.
**Preserved:** the two rejected DMGs (`6aecab86…`, `455eb12d…`) are byte‑identical after the work
(`receipts/originals-preserved.txt`), their failed receipts stay in the review pack untouched, and the
in‑tree bundle outputs were copied aside before rebundling.

## MACV‑R1 — one safe OLD→NEW profile sequence, offline history, deterministic comparison (P1)
Delivered as `docs/evidence/mac-schema13-preparation-corrections-2026-10-08/RUNBOOK-G1-G3.md`:
- Single chronological walkthrough **OLD first** (fresh task‑owned schema‑12 library) → populate
  through the installed UI → complete the 2‑question practice attempt and rate a card → export a
  **genuine** schema‑12 `.hfdbackup` → quit, verify no process, preserve the **whole** profile folder →
  **NEW against that same active profile** → capture the upgrade comparison *before* any new action →
  G1 + a new split + schema‑13 backup → quit and preserve → switch back to the preserved schema‑12
  baseline for the **OLD refusal** test → restore the upgraded root for the **NEW restore** test. Every
  switch is explicit, reversible and performed with **neither app running**; no env‑var guessing, no
  loose live‑database copy, and OLD is never pointed at the schema‑13 root.
- Installs only under `/Users/hfdtest/Applications/HFD-NEW-36a7b39/` and
  `.../HFD-OLD-2a6a415/` (distinct paths, since both share name, id and version), launched by full
  path, with pre‑launch confirmation of uid 502, non‑admin membership, and the resolved data root
  `/Users/hfdtest/Library/Application Support/com.herflightdeck.app` (verified against
  `storage.rs::app_root` + `lib.rs` `sqlite:her-flight-deck.db` — there is no override), plus
  in‑session re‑verification of every transferred hash.
- Offline histories use the accepted packet
  `src/testing/fixtures/study-packets/02-flashcards-and-test.json`
  (`d5101e8c58c70c21943295bb22ec5c88394c8db81aeec402bd8f7836612e1f99`, 3 flashcards + 2 questions,
  hash recorded in the runbook) through **Add material** ▸ PDF chooser and **Import study packet…** ▸
  **Import as new material**, with the exact UI actions — no provider key, no network call.
- New helper `scripts/mac-schema13-profile-snapshot.mjs` (read‑only): `_sqlx_migrations` (falling back
  to `schema_migrations`) is the schema authority, **not** `PRAGMA user_version`; it enumerates the
  real tables `practice_attempts`, `practice_responses`, `card_review_state`, `card_review_events` plus
  materials/tags/versions/items/generations and `documents/` file anchors; serializes every column
  through SQLite `quote()` (type‑faithful NULL/INTEGER/REAL/TEXT/BLOB, no JSON number drift) ordered by
  each table's real primary key; opens the live DB read‑only and, when a non‑empty WAL exists, reads a
  **copy** of db+wal so committed frames survive without touching the original; refuses a wrong uid, a
  non‑profile root and a still‑running app. Isolated checks (`receipts/helper-self-check.json`,
  exit 0, 8/8): ledger authority + schema‑12 state, unchanged‑control compares clean, modified history
  **detected**, non‑profile root **refused**, mismatched owner uid **refused**, WAL copy path leaves the
  original bytes unchanged while honouring the committed row, and applying the **real shipped 0013**
  keeps retained history identical with both new tables present and ledger 13. No application matrix was
  rerun for this.
- Upgrade comparison and later deliberately created histories are separated: `compare` runs before new
  user actions, and `--history-only` exists for later comparisons.

## MACV‑R2 — corrected expectations and physically reachable cases (P2)
- Removed every "of 400": A is a **10‑page** root, so pages 3–7 yield a **5‑page** child reading
  *pages 3–7 of 10*, "In the original, that is page 3"; B is **1,050** pages, so B101–300 is a
  200‑page parent and its own 20–40 is a **21‑page** child at root **120–140 of 1,050** (C2: 60–80),
  with copy‑page destinations stated separately (**3** into A; **20** into the parent, **120** into B)
  against the child's own page 1 — coordinate guidance and viewer page are not conflated.
- Companion siblings are now created through the UI in both tiers: direct siblings by splitting A
  1–5, 3–7 and 6–10 (same root id + same source content hash, so all three list each other —
  **different selected ranges are not different editions**), nested siblings by splitting the same
  parent's 20–40 and 41–60 (grouped by the **immediate parent's** id + hash), and the runbook states
  that a nested child must not list direct children of B, plus the observed id/title list.
- Cancel/failure instructions fixed: closing before **Save this chapter** performs no split at all, so
  the assertion is *no receipt, no part file, source unchanged, nothing to clean*; while saving both
  dialogs are `dismissible={false}` with Cancel disabled, so no dismissal race is claimed.
- Added a genuinely reachable installed failure with exact cause, assertions, retry and owned cleanup:
  `chmod u-w …/backups` makes the dialog's **first** action (`createBackup()`, before any receipt) fail,
  so nothing is created at all; restoring writability then succeeds. Screenshot, empty `snapshot` diff
  and `documents/` listings are the observation.
- The accepted post‑receipt pending/reconcile/cancel obligation is **not** silently weakened or faked.
  In the frozen bundle receipt creation and save run back‑to‑back with no human window and no fault‑
  injection seam, so that subcase is recorded **blocked / source‑covered** in the runbook, citing
  `an_edited_or_unrecorded_receipt_saves_nothing`,
  `a_source_moved_to_another_file_or_removed_before_saving_is_refused`,
  `an_existing_output_id_or_a_mid_save_failure_saves_nothing`,
  `a_cancelled_split_stays_cancelled_and_cannot_be_saved`,
  `cancelling_removes_only_its_own_files_and_never_touches_a_saved_split`, the `splitSave` read‑back UI
  tests and sensitivity S1/S3, and proposes the smallest separately reviewed seam (a debug‑only
  `#[cfg(debug_assertions)]` pause/fault hook or dev‑build‑only cancel command, absent from release
  binaries). No hidden production bypass was added and no unit test is offered as a physical pass.

## Changed paths, mapped to findings
| Finding | Paths added / changed |
| --- | --- |
| MACV‑R3 | `inspect-adhoc-packages.py`; `receipts/{NEW,OLD}-…-adhoc.dmg.{attach,exe-verify,bundle-verify,signature,arch,plist}.txt` (12 files); `receipts/package-results.json`; `receipts/adhoc-overlay.json`; `receipts/rebundle-{new,old}.log`; `receipts/originals-preserved.txt` |
| MACV‑R1 | `scripts/mac-schema13-profile-snapshot.mjs` (new read‑only helper, mode 0644 like the other scripts), `receipts/helper-self-check.json`, `RUNBOOK-G1-G3.md` (sequence, installs, root/uid confirmations) |
| MACV‑R2 | `RUNBOOK-G1-G3.md` (coordinates/counts, sibling fixtures, cancel + reachable failure + blocked subcase), `receipts/fixture-hashes.txt` |
| hygiene | `.gitattributes` — two narrow `-whitespace` lines for the raw `hdiutil` mount receipts only (verified `whitespace: unset` for those two paths); all authored docs, the helper and the JSON receipts carry no trailing whitespace, so no other exemption was needed. No source, schema, config or lockfile was touched. |
| tracking | `docs/MAC_SCHEMA13_PREPARATION_CORRECTIONS_2026-10-08.md`, this evidence `README.md` + `SHA256SUMS`, STATUS.md, `docs/PROJECT_HANDOFF.md` |

## Verification, evidence and boundary
- Evidence pack: `docs/evidence/mac-schema13-preparation-corrections-2026-10-08/` — `README.md`
  (fully enumerated manifest, including the two `.log` receipts matched by `.gitignore:120` which must
  be `git add -f`'d), `RUNBOOK-G1-G3.md`, `inspect-adhoc-packages.py`, 19 receipts and `SHA256SUMS`
  (22 entries, `shasum -c` all OK, no file unlisted).
- Prior evidence untouched: the original 8‑entry manifest and all 12 submitted paths remain exactly as
  the review froze them; nothing was re‑run over a prettier copy.
- No GUI launch occurred anywhere: app binaries were only mounted read‑only, inspected and detached.
  The everyday profile was never used or redirected; no keychain/Account change; no CI trigger; no
  provider call; no signature/notarization provisioning.
- **Still required from a person:** execute `RUNBOOK-G1-G3.md` in `hfdtest` and record each observation,
  recording **whatever macOS actually does** at first launch (per‑app flow only, preserving any block).
  Until then G1–G3 stay UNVERIFIED — source acceptance, strict package checks and the helper's own
  checks cannot pass them. Developer ID signing, notarization, a release version beyond `0.5.3` and
  public distribution remain separate owner decisions, all untouched here.

Work is left **uncommitted and unpushed** for independent review.
