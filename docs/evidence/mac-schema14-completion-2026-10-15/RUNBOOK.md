# Schema-14 installed verification — canonical future walkthrough (15 October 2026)

This is the one canonical walkthrough for a **future** installed run of a schema-14 candidate. Nothing in it has been executed. It cannot start yet: no schema-14 candidate exists, and the inputs in §1 are missing. Do not substitute the frozen v0.5.3 / schema-13 candidates or kit, and do not invent values.

## 0. Lane (unchanged from the owner's approval)

- Run only in the macOS account `hfdtest`, uid 502. It must be a standard account, not a member of `admin`.
- Profile: `/Users/hfdtest/Library/Application Support/com.herflightdeck.app`. The helper accepts no other root and has no flag to change that.
- Never run any step in the everyday account. Never point either app at another library. Never bypass Gatekeeper globally.
- Synthetic data only.

## 1. Inputs the run needs

The owner selected v0.5.4 and the local unsigned/ad-hoc candidate route. Source review and integration precede that build. No installer exists yet; physical testing remains deferred. The choices below do not grant permission to launch an app or access a profile.

| Variable | Meaning | Status |
| --- | --- | --- |
| `HFD14_CANDIDATE_COMMIT` | Source commit the candidate was built from. It must contain migrations 1–14 exactly as pinned by the helper’s immutable schema contract (`8a260c0…`); this continuation is prepared on accepted main `16f9cf3…` with identical migrations/fixtures, with no migration 15. | unavailable |
| `HFD14_DMG` / `HFD14_DMG_SHA256` | Candidate installer and its SHA-256 | unavailable |
| `HFD14_BIN_SHA256` | SHA-256 of `Her Flight Deck.app/Contents/MacOS/her-flight-deck` inside the DMG | unavailable |
| `HFD14_VERSION` | Selected next app version; bundle identifier stays `com.herflightdeck.app` | v0.5.4 selected; source configuration still 0.5.3 pending its own reviewed change |
| `HFD14_BASE13_DMG` / SHA-256 | A schema-13 build to create the populated schema-13 library before upgrading. It must be a separately authorized identity; the frozen kit is not retargeted. | unavailable |
| `HFD14_KIT` | Read-only staged kit containing this helper, `env.sh`, a transfer manifest and a reviewed operator tool for the schema-14 kit, with `stopped`, `new-run`, `copy`, `move`, and run/operation-bound `block-backups` / `unblock-backups` | unavailable: the schema-13 `hfd-operator.sh` is bound to its own kit and candidates |
| Owner authorization | Existing hfdtest isolation policy is retained, but physical execution is deferred | no installed run is requested by this preparation |

## 2. Variables used below

Once the inputs exist, they come from the kit's `env.sh`:

```bash
export HFD_NODE="/opt/homebrew/opt/node@22/bin/node"
export HFD14_HELPER="$HFD14_KIT/bin/mac-schema14-profile-snapshot.mjs"
export HFD_OP="$HFD14_KIT/bin/hfd-operator.sh"          # schema-14 kit's reviewed operator tool
export HFD_ROOT="/Users/hfdtest/Library/Application Support/com.herflightdeck.app"
export HFD_EVID="/Users/hfdtest/Downloads/hfd-schema14-workspace/evidence/$HFD_RUN_ID"   # fresh per run
```

Every snapshot and comparison writes to a new absolute path under `$HFD_EVID`. The helper refuses an existing, symlinked or aliasing destination.

## 3. Before any step

```bash
/usr/bin/id -u; /usr/bin/id -un; /usr/sbin/dseditgroup -o checkmember -m hfdtest admin
"$HFD_NODE" --version                    # v22.x
/usr/bin/shasum -a 256 "$HFD14_HELPER"   # must equal the reviewed helper hash in source-manifest.json
```

The helper has no self-check of its own in the kit: `self-check` refuses with exit 2. Its regressions run only in the repository (`node scripts/mac-schema14-verification-proof.mjs self-check`), before the kit is staged.

Expected output: `502`, `hfdtest`, `dseditgroup` exit 1 (not a member). Before **every** snapshot, quit the app with Cmd-Q and run `"$HFD_OP" stopped`. The helper refuses on its own if any process is found or inspection fails.

## 4. Gates

| Gate | Before → after | `--purpose` | PASS means |
| --- | --- | --- | --- |
| U1 upgrade | populated schema-13 library (debriefs, practice, cards, a split, managed PDFs) → after the first schema-14 launch and quit | `upgrade` | Migration 14 is recorded with the pinned SQLx checksum. All retained rows, metadata and file bytes are identical. Only the exact catalog seed is added, and the evidence tables are empty. |
| U2 invariance | schema-14 library holding Skills evidence the app created (observation, edit, link, status, confidence, custom skill, erased observation) → after a cancelled dialog | `unchanged` | Every fact is identical, including M3 history and tombstones. |
| U3 safe failure | same library → after a save attempted while `"$HFD_OP" block-backups` is active, then `"$HFD_OP" unblock-backups` | `unchanged` | Nothing changed, and the write block was recovered (permission facts are identical). |
| R1 restore | snapshot after exporting a schema-12, -13 and -14 backup → after restoring each into the schema-14 app and quitting | `restore` | Only `last_complete_backup_at`, `last_complete_backup_path` and `last_complete_backup_version` may differ, and the result says so. Everything else is identical; restores from older schemas add only the seed and empty tables. |

Command shape (identical for every gate):

```bash
"$HFD_OP" stopped
"$HFD_NODE" "$HFD14_HELPER" snapshot --json "$HFD_EVID/<gate>-before.json"
#   ... the one UI action for the gate, then Cmd-Q ...
"$HFD_OP" stopped
"$HFD_NODE" "$HFD14_HELPER" snapshot --json "$HFD_EVID/<gate>-after.json"
"$HFD_NODE" "$HFD14_HELPER" compare --before "$HFD_EVID/<gate>-before.json" --after "$HFD_EVID/<gate>-after.json" --purpose <purpose> --json "$HFD_EVID/cmp-<gate>.json"
```

`compare` exits 0 on PASS, 1 on FAIL and 2 on refusal. Keep every receipt, including FAIL ones; never rerun over an existing output. If `snapshot` refuses because `backups/`, `.restore-staging/` or `.restore-pending/` is a symlink, stop and report it; do not move or delete anything in the data root. `--purpose history` is partial by design and never a gate result.

## 5. Still out of scope

- Mid-save fault injection after a backup receipt: release binaries have no reachable seam.
- Developer ID signing and notarization.
- Release.
- M4 production decisions.

## 6. Hand back

Hand back the whole `$HFD_EVID` folder, terminal logs with exit codes, the DMG/binary hashes as observed, and screenshots of the gate actions. Profiles and backups stay local.
