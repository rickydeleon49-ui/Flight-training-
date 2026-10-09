# Mac schema-13 snapshot helper and operator kit — model-neutral correction assignment

You are the implementer. Finish **MACV-R4–R6 together** in one bounded correction round, preserving the accepted application source and the now-valid local installers. Read `docs/MAC_SCHEMA13_PREPARATION_REREVIEW_2026-10-08.md`, its frozen diagnostics/28-path submission manifest, the submitted correction report/runbook, previous MACV-R1–R3 review and current STATUS/handoff. This review closes MACV-R3; **do not rebuild/rebundle either candidate**. The remaining work is the read-only helper and human walkthrough.

## Starting state and scope

Primary `/Users/rickymac/code/Flight-training-` remains dirty at source HEAD `36a7b39`. The reviewer published independently; fetch/read missing review documents from `origin/main` with `git show`, without pulling/resetting/stashing over the dirty primary. Verify the frozen 28 submitted hashes before editing and disclose actual competing changes. Preserve both original evidence packs, raw failures, original DMGs and corrected `*-adhoc.dmg` candidates byte-for-byte. Write corrected evidence in a new directory. Use the existing recorded hfdtest UID502/non-admin/synthetic/local ad hoc lane without asking for repeat authorization.

No application feature, migration, provider, dependency/lockfile, tracked release-config, signing credential, public-release or archived-clone work. No everyday-profile GUI launch. Do not implement the proposed post-receipt debug seam in this assignment; keep that installed subcase blocked/source-covered with the existing proposal. The senior reviewer owns commit/push/PR/integration. Leave your result uncommitted/unpushed.

## MACV-R4: enforce stopped-app/isolation/output boundaries

Fix `guardProfile`: classify process-inspection results explicitly. Only the documented no-match status is success. Matched PIDs must refuse outside the catch; exit2/unavailable/permission errors/malformed results must refuse. Inspect both candidate processes reliably before any database/WAL copy; do not treat sandbox inability to inspect processes as proof none are running. Include meaningful permanent tests for matched PID, no match and inspection error, checking no DB/WAL/SHM read/copy/write happens on refusal. Use a test-controlled inspector with the exact production result-classification logic, without launching an app or weakening the operator entrypoint.

Make operator snapshot mode require actual UID502, standard-account status, canonical approved root and owned real files. The defaults currently allow arbitrary uid/root by omission. Do not solve this by requiring the operator to remember optional safety flags. Guard symlink/root escapes and regular file expectations. Keep scratch self-check fixtures available through an explicitly isolated internal test path that cannot turn the operator CLI into an arbitrary everyday-profile reader.

Before any report write, reject an output path that is inside the profile or aliases a protected DB/WAL/SHM/managed file, including symlink/hard-link aliases where applicable. Reject compare output aliasing either input receipt. Avoid clobbering previous evidence; require an explicit fresh task-owned output path. The frozen test proves `--json` can currently overwrite the scratch input DB with JSON. Fix that behavior and demonstrate all input bytes remain identical on refusal. Ensure temporary DB/WAL-copy cleanup also runs if copying/opening fails; keep original input files read-only and verify complete committed WAL state only under confirmed quiescence.

## MACV-R5: complete digests and explicit comparison purposes

Replace `quote()`-only/character-delimiter hashing with a deterministic framed encoding of column identity/order, storage type and full stored value. Include complete embedded-NUL TEXT bytes, control separators/quotes, BLOB bytes, exact 64-bit INTEGERs, REAL distinctions and NULL. Check actual primary keys/columns and stable ordering; do not silently fall back to arbitrary row order. The frozen NUL test must detect the actual changed SQLite bytes, not just a synthetic JSON change. Add focused controls for unchanged content, order independence, each storage type, changed row/column/file and missing schema facts.

Inventory the real shipped schema (0001–0013). Include retained operation/tombstone tables where a claim of unchanged library requires them, not only visible practice/card history. Validate the snapshot schema/version, required table entries/column identities/hashes/counts, ledger facts, file anchors and approved root/owner metadata before comparison. Two missing history maps or missing required tables must not become a PASS. Verify OLD baseline contains the offline packet's completed attempt/responses and card state/event; don't award populated-data proof to an empty fixture library.

Define purpose-aware contracts and document exact CLI commands:

- **unchanged/refusal:** schema12 before/after; same complete ledger, retained tables/history and managed-file bytes. OLD rejecting a newer backup must pass when these remain unchanged and fail when any protected datum changes.
- **upgrade:** genuine schema12 baseline → schema13; real desktop migration ledger/table presence, all retained history/file bytes unchanged; only allowed schema13 additions differ. Run comparison before any new user activity.
- **restore:** genuine schema12 backup baseline → restored/new schema13; validate expected migration and restored materials/files/history. Changed documents must fail even with identical history.
- Optional **history-only:** explicitly partial; cannot set the overall installed-gate PASS. The current runbook's Step D flag skips files and ledger. Correct the call and verdict schema together.

The frozen review diagnostic supplies `purpose: history/unchanged/restore` as an intended-contract hint; its assertions and fixtures stay authoritative. Rerun it against the corrected source. If your private API/module structure changes, disclose a thin compatibility adapter with identical assertions rather than rewriting failures into successes. Promote all seven failures as permanent regressions and retain original failing and final passing receipts.

## MACV-R6: standalone, consistent human kit

Stage the synthetic PDFs A/B/C, offline packet, corrected helper and clear Node22 runtime invocation in an operation-owned readable kit. It must be usable from the hfdtest desktop without access to the everyday user's private repository paths. Include full transfer hashes and exact final candidate/source identities; verify the existing candidates, not a replacement build. Avoid `…`/angle-bracket placeholders in executable commands; use explicitly defined task variables/absolute paths, with a fresh evidence directory and refuse-existing destinations. Never assign HOME/CODEX_HOME.

Keep OLD first and the established schema12 backup → NEW upgrade/G1/schema13 backup → preserved schema12 OLD refusal → preserved upgraded NEW older-backup restore sequence. Add explicit Quit/confirmed stop before **every** helper snapshot, comparison baseline capture or whole-profile copy/switch. The current A1/A7/B3/B6/B7/D3 live snapshots conflict with the correct guard. Relaunch by the exact distinct per-user app path when the next UI action requires it. Snapshot after upgrade before any other app action; choose the purpose-specific comparison for each gate.

Correct nested C2: parent original101–300, child own41–60 → root141–160 of1,050, child20 pages. Preserve correct C1 root120–140/21 and A3–7/5, actual sibling grouping and clipboard coordinates. Record real IDs/titles, complete page coverage and responsiveness for automatic cases.

Make profile switches reversible and validated: actual hfdtest identity/root, both apps stopped, source snapshot exists/complete, destination absent. Retain the refusal-test active profile by moving it to a new task-owned archive path rather than deleting it. Prevent cp/mv nesting on reruns. For the chmod backup-failure case, capture the original directory mode and restore it on success, failure or operator abort. Quit before before/after helper checks, then relaunch for retry. Name the exact expected unchanged tables/files; startup/safety backup artifacts are not automatically evidence of failed refusal. Record full backup manifest, backup hash and source/candidate provenance, not just the shared version number.

Do not perform GUI flows in the everyday profile. If a person is needed for hfdtest UI, complete all independent preparation and provide the numbered human steps; no simulated installed PASS. G1–G3 remain UNEXECUTED/UNVERIFIED, and the post-receipt recovery subcase remains BLOCKED until separately reviewed physical evidence exists.

## Evidence and finish

Deliver one new report/runbook/helper evidence pack mapping R4–R6 to exact changes, meaningful tests and operator acceptance criteria. Run the helper checks/diagnostics on isolated scratch data with Node22.23.3; preserve stdout, stderr, exact exits and environmental process-inspection limitations. No full application test matrix/rebuild is needed for this bounded change; broaden only for a new application change or an unresolved relevant failure. Verify all earlier production anchors/migrations/configs/candidate hashes remain unchanged.

Enumerate every receipt (including ignored logs), complete checksum manifest and final source hashes for review. Update STATUS/handoff honestly, preserving earlier rows as historical and avoiding “all findings closed” before independent acceptance. Report exact modified/untracked/staged state and outstanding human-only work. Leave all changes uncommitted/unpushed, and stop after this correction assignment.
