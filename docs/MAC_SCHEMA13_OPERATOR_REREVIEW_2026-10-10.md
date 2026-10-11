# Mac schema-13 operator corrections re-review — 10 October 2026

**Decision: CHANGES REQUESTED.** R7/R8's earlier concrete failures are corrected, but three bounded follow-ups remain before the human walkthrough is accepted: MACV-R9 operator test isolation/recovery binding, MACV-R10 complete snapshot validation/restore ledger, and MACV-R11 executable walkthrough identity and sequencing. Accepted application source and local ad hoc installers are unchanged. G1–G3 remain UNEXECUTED/UNVERIFIED.

## Independent checks and retained progress

- Froze all30 submitted paths; previous submission differs in exactly3: helper, STATUS and PROJECT_HANDOFF. All13 production anchors match. Prior evidence remains byte-identical. The submitted report's29/30 count does not reflect its final tracker edits; actual final count is27/30.
- Submitted24-entry evidence manifest verifies. The10-file Shared kit manifest verifies, including both accepted DMGs. Kit helper/operator/runbook/env hashes match the new submitted copies.
- Helper self-check:86/86 pass. Original reviewer helper diagnostic, unchanged:7/7 pass. Earlier frozen diagnostic:10/10 pass.
- Original operator diagnostic:6/6 pass with only its source-file locator changed to the new operator; command logic and expectations unchanged. Submitted expanded operator diagnostic:21/21 pass. Operator self-test:22/22 pass.
- New independent operator cases:2 controls pass,2 fail, exit1. New helper cases:2 controls pass,3 fail, exit1. All data is disposable reviewer-owned scratch. No real profile, account login, installation, GUI launch or candidate rebuild occurred. Submitted revert receipts are preserved; the seven submitted mutants were not independently rerun because the new failures already determine disposition.

## MACV-R9 — Remove shipped test overrides and bind recovery to its run [P1]

References: new `hfd-operator.sh:40–57,158–164,205–211,297–324,341–376`; env and runbook§1.4.

The shipped operator reads `_HFD_TEST_TOOLS_DIR` to replace trusted identity/process inspectors, `_HFD_TEST_ROOT` to replace the approved root, and PATH patterns ending in `/tools` to replace inspectors or skip ownership. These are reachable environment switches in the actual staged script, not a scratch-only adapter. Without editing that script, a uid501 shell with controlled environment probes successfully copies a profile under an arbitrary scratch root and reports OK. No real profile is accessed in the diagnostic. Remove this logic from the distributed script. Tests may rewrite a scratch copy's exact constants/inspector bindings or exercise an internal module not reachable by the production entry point; preserve production ownership checks under controlled stat fixtures, rather than skipping them. Validate approved per-user workspace boundaries and symlink components; user environment must not redefine an arbitrary mutation lane.

Permission records now safely represent spaces and exact modes, which should be kept. However RUN_ID and OP_ID are parsed but never checked, and default recovery still chooses the newest record from the shared evidence parent. The runbook defines HFD_EVID but no HFD_RUN_ID and does not route records to HFD_EVID. Reproduction: block/unblock runA at0700, change original mode to0750 and block runB at0550, then pass runA's old record to unblock under runB. It exits0 and restores0700 rather than refusing and leaving0550. Bind current run and active permission operation, record path/ownership and directory identity. Use an explicit recorded operation, not newest-file guessing. Missing/duplicate run/operation facts must refuse. Preserve same-run idempotent recovery and provide interrupted-run recovery using the original run's explicit context.

## MACV-R10 — Refuse incomplete v3 anchors and invalid restore ledger [P1]

References: `scripts/mac-schema13-profile-snapshot.mjs:833–895,1008–1011,1097–1128,1130–1160`.

Actual schema-13 row changes and missing indexes now fail, as required. Keep those fixes. But v3 validation only requires definitions to be an object; comparison skips each object whose entry is absent. Replacing the definitions map of an otherwise real schema13 capture with `{}` yields full gate PASS for both upgrade and restore. This models an incomplete receipt, not an alleged source-storage defect. Require every named object to have a valid type/definition anchor, enforce exact inventory/key/count relationships and reject incomplete current receipts before verdict. Apply the same complete-fact checks to ledger rows/digest/columns and table keys needed by each contract; don't infer missing facts or silently skip validation.

Restore uses `maxVersion >=13` plus a prefix check, without requiring migration13 to exist. On a real scratch DB migrated by shipped0013, changing the actual ledger row from version13 to14 and recapturing yields restore PASS even though13 is absent. For these pinned candidates require the actual12→13 ledger sequence, successful migration13 with shipped checksum, all earlier row content retained, and consistency of rows/versions/maxVersion. Unexpected14 or missing13 must refuse/fail. Genuine complete upgrade/restore controls must continue to pass.

## MACV-R11 — Correct package identity and runnable human steps [P1]

References: new `RUNBOOK-G1-G3.md:24–25,59–94,103–127,157–169,205–263`; submitted report§6.

The runbook lists NEW executable47a3fd… and OLD7e997f…; neither matches the accepted corrected DMG identities. The accepted executable hashes are:
- NEW `824688939086c16bd5ec8be7312545725d79ce284ebab2fe3ed0d1eaf400eb28`
- OLD `2e44bfbbd1dd65e93697d65ca8b5beff5237173e4dbf8484a89ee21f9c98842a`
Accepted DMGs remain b3ead813…/ddb0594e… and their bytes independently hash-match. Correct documentation; do not build/sign replacement binaries to satisfy erroneous text.

Installation merely prints a mounted hash and copies unconditionally. It has no cleanup trap despite the report claiming one; attach/hash/copy failures can continue to later steps. Provide a bounded checked install function/script that verifies exact DMG and executable hashes, refuses existing/dangling targets and unsafe parents, uses fresh task mountpoints and reliably detaches on failure/interruption. Human account/workspace checks must actually gate these steps, including inspector errors and fresh ownership/writability checks. Preserve existing installations instead of nesting or overwriting.

The runnable walkthrough also omits importing fixtureC before asking for its auto-split. Its cancel baseline follows live split work without an explicit quit. After the retry it explicitly quits NEW, then asks for Settings backup without relaunch. Restore inspection similarly needs relaunch after its snapshot. Correct every launch/quit transition and prerequisites in one chronological walkthrough, retaining detailed root/parent grouping and copy-page expectations from the prior accepted preparation. The report's separate summary uses undefined HFD_OPERATOR/HFD_SNAPSHOT_HELPER/HFD_EVIDENCE, unsupported --out, and compares unchanged after deliberate study mutations. Remove that conflicting executable summary or make it match the one canonical runbook exactly. Preserve the old report as a historical submission and publish current corrections in a new report.

## Next action

Finish R9–R11 together with the [active model-neutral assignment](MAC_SCHEMA13_OPERATOR_FINAL_CORRECTIONS_PROMPT_2026-10-10.md). No app matrix, migration, dependency, installer rebuild or new roadmap task is needed. Prior fixes remain valuable; installed testing waits for accepted preparation. Owner authorization for hfdtest/synthetic/local candidates persists; no repeat approval is requested. Post-receipt recovery remains BLOCKED/source-covered.

[Frozen submission and executable diagnostics](evidence/mac-schema13-operator-rereview-2026-10-10/README.md). Primary dirty implementation was preserved throughout. Review-document publication does not integrate the pending helper/operator into shipping source or certify installed gates.
