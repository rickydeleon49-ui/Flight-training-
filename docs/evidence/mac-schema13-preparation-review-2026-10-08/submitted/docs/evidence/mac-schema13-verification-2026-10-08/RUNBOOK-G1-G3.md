# Operator runbook — Mac schema‑13 physical gates G1–G3 (isolated `hfdtest` session)

**Lane:** approved isolated standard (non‑admin) account `hfdtest`; **LOCAL UNSIGNED candidate** built
from the exact merged commit. Label every result **"local unsigned — not Developer ID signed, not
notarized, not publicly distributable."** Use synthetic, operation‑owned data only; **never** the
owner's everyday profile or library. These phases must be executed and recorded by a person in the
`hfdtest` GUI session (the read‑only preflight cannot prove isolation or observe the desktop). Do not
mark a phase pass without the recorded observable.

## Candidate identity (verify before installing)
- NEW (app under test, schema 13) `NEW-schema13-36a7b39.dmg` — dmg `6aecab8608224f9e3f272dff1b8ace4f23d699566329ef1d24e5ab95bb1b0c99`, exe `9c7056c3435b526eff8281d9dbb14daf570983024116a368d6d9d81b61022a2b`, arch arm64, ad hoc.
- OLD (schema‑12 binary) `OLD-schema12-2a6a415.dmg` — dmg `455eb12d3f906fd60cef529e2aca464c98ae81e36e48c62d8afd73a092681fcd`, exe `efc33cb8fa5e7f1916cda3ca957fca80e328030361fc0e714bdb8333a7d72527`.
Staged at `/Users/rickymac/code/.qwen/tmp/schema13-candidates/`. Verify `shasum -a 256` matches, then
copy into `hfdtest` (e.g. its `Downloads`). Because the build is unsigned, Gatekeeper will refuse a
double‑click; open once via right‑click ▸ Open (the ordinary identified‑developer confirmation is not
itself a PASS — record the app actually running).

## Fixtures (regenerate, then confirm these hashes)
`node scripts/generate-pdf-fixtures.mjs "$TMPDIR/hfd-fixtures"` must reproduce:
- A `synthetic-small-checklist.pdf` 10p `f6c593f9…24b134`
- B `synthetic-long-manual.pdf` 1,050p `0ba9a7e2…f9692c1`
- C `synthetic-illustrated-charts.pdf` 60p 54,032,644 B `b5651eb6…1ab096d`

---
### G1 — Installed Apple Silicon smoke
Log into `hfdtest`; install the NEW candidate; use a fresh `…/com.herflightdeck.app` data dir.

1. Import Fixture A via the native picker → managed copy under `documents/`, original renamable,
   app copy hash unchanged. [obs: ______]
2. **Manual split** of A pages 3–7 → part saved; on the part page: original link, "pages … of 400",
   other‑parts‑from‑same‑copy list, **Copy page 3** (viewer opens the part at its page 1). [obs: ______]
3. **Automatic split** of B → 2 ordered non‑overlapping parts; lineage records engine page count. [obs: ______]
4. **Nested split**: split B pages 101–300 → part A (200p). Then split **A's own pages 20–40** → part P.
   Verify on P's page: taken‑from A **pages 20–40 of 200**; original B **pages 120–140 of 400**; **Copy page
   20 of A**; related parts are A's other 20‑40‑edition siblings only. Expected child page count **21**. [obs: ______]
5. **Cancel** a split (close before save) → the split's own part files removed, source untouched;
   **failed save** (e.g. change the source file after the receipt) → nothing written, record stays
   `pending`, interface reconciles then cancels. [obs: ______]
6. **Restart** the app → no duplicated parts; reopen a part → lineage verdicts present; original
   + retained child files preserved. [obs: ______]

### G2 — Upgrade of populated schema‑12 data (installed app, not a SQLite script)
1. In `hfdtest`, install the **OLD** schema‑12 candidate (fresh data dir).
2. Populate through the app: import A + B; take one practice test to a **completed** attempt with a
   response; rate a card (card state + event); note counts.
3. Record **before** snapshot: row counts of `practice_attempts/responses`, `card_review_state/events`,
   `study_materials`; and a canonical sha256 of each history table's `SELECT * ORDER BY rowid`. [before: ______]
4. Quit; **install the NEW candidate over the same profile** (do NOT wipe data). Launch.
5. Verify migration 13 applied (`material_split_lineage`, `split_operation_log` present; `user_version`/
   max migration = 13); **every** before history row unchanged (recompute the same canonical hashes; they
   must equal before); a **new split creation still works**. [after: ______  pass/fail: ______]

### G3 — Backup compatibility (physical)
1. In the NEW app (`hfdtest`), export a **schema‑13** `.hfdbackup` (Settings ▸ Data management).
2. With the **OLD** binary pointed at its own existing schema‑12 fixture library, attempt to restore that
   schema‑13 backup → it must **refuse** ("newer database format") and **not modify** its existing library
   (verify its before hashes unchanged). [refusal observed: ______  library unchanged: ______]
3. In the NEW app, restore a genuine **schema‑12** backup (export it from the OLD app in step G2.2) →
   materials/files/histories restored intact. [restore pass/fail: ______]
4. Keep candidate identity + backup provenance explicit; **do not** substitute a numeric simulation.

### Recording
For each phase capture: exact commands + exit codes where applicable, screenshots of the important
desktop flows (import, part page lineage, nested coordinates, restore/refusal dialog), and the
before/after hash anchors. Store under `docs/evidence/mac-schema13-verification-2026-10-08/installed/`.
Cleanup is task‑owned only (fixture copies in `$TMPDIR`, the `hfdtest` profile, staged DMGs); never
delete the owner's data. A local‑unsigned build can certify **behaviour**, not Developer ID/notarized
distribution.
