# Mac readiness preparation: independent acceptance — 3 October 2026

**Accepted for source integration.** Codex re-reviewed Claude's corrected read-only preflight and installed-test/signing runbook and closes READINESS-R1–R4 from the [original review](MAC_INSTALLED_READINESS_REVIEW_2026-10-03.md). This accepts the preparation tool and documentation only. Installed behavior, macOS 12, signing, A2 production source and release approval remain unverified or pending.

## Reviewed identity and scope

Branch `codex/mac-installed-readiness-preparation`, implementation base `8b159485a66804a368dde5f4d7eea596b63bbfcc`. All eleven full corrected-handoff hashes matched; the three original receipts also matched their original hashes.

The actual inventory is fourteen implementer files: seven changed from the original ten-file delivery, four new correction receipts and three unchanged historical receipts. The pasted summary's “8 changed” and “5 new” labels are counting errors; its named files and hashes match the reviewed inventory.

No application runtime module, package, lockfile, migration or workflow changed. The executable addition is [the preflight](../scripts/mac-readiness-preflight.mjs), with [its tests](../src/logic/macReadinessPreflight.test.ts), [usage/schema reference](MAC_READINESS_PREFLIGHT.md) and [runbook](MAC_INSTALLED_READINESS_PREPARATION_2026-10-03.md). [Implementation evidence](evidence/mac-installed-readiness-preparation-2026-10-03/README.md).

## Findings closed

| Finding | Independently reviewed outcome |
| --- | --- |
| R1: signature metadata substituted for integrity; app/DMG conflation | App PASS requires successful display and strict deep verification plus expected signing identity fields. Failed commands cannot contribute trusted metadata. DMG integrity is checked separately without application runtime/bundle-ID requirements; the unopened inner app stays UNVERIFIED. |
| R2: SDK presence substituted for compatibility | Directory type, readable metadata and identified version are separate observations. Evidenced SDK 26.5 passes; documented incompatible 27.0 fails; unproven/unreadable metadata stays UNVERIFIED. Explicit selection and SDKROOT are covered; synthetic absence cannot fall through to physical SDK files. |
| R3: arbitrary certificate/source text in public receipts | Known authority and assessment sources become fixed categories, unknown values become unknown. Other observation fields and CLI errors were tightened; raw output, private holder names and paths in the reviewed probes are absent. |
| R4: normal first-open confirmation treated as refusal | The scenario table allows ordinary confirmation during a later authorized run when identity/prerequisites match. Security refusals still stop dependent phases. Installation scope and owner-entered authentication are documented separately. |
| Private-environment clarification | Private-repository reviewer eligibility is explicitly unverified. CI signing is conditional on confirmed protection; local/manual signing is an owner-reviewed alternative. Naming an environment alone is not described as an approval gate. |

The receipt uses schema `hfd-mac-readiness-preflight/2`; historical schema-1 receipts are preserved and the changes are documented.

## Independent verification

- Focused preflight and unchanged release-safety suites: **85 passed, 1 deliberate skip**, exit 0. Of these, 34 are preflight tests.
- Typecheck and diff check: exit 0.
- Seven independent injected probes: **7/7 desired outcomes on corrected bytes**, exit 0; **0/7 on the reviewed old bytes**, exit 1 intentionally. The probe harness is outside normal test discovery and uses no actual macOS artifact commands.
- Default actual host recheck: **9 PASS, 0 FAIL, 3 UNVERIFIED, 3 USER_ACTION**, exit 0. Installed readiness remains false; source was dirty at capture. The receipt contains no `/Users/` path.
- R4 and signing-plan changes: direct document review against the cited primary references, not installed execution.

Claude's isolated comparison of the same corrected test file reports 23 failures and 11 passes on the old script and 34 passes on the corrected copy. Codex reviewed that receipt but did not repeat the full comparison. Some old failures assert changed schema/check names, so 23 is not a count of distinct original bugs.

Exact input hashes, commands and independent results: [Codex evidence](evidence/mac-installed-readiness-acceptance-2026-10-03/README.md). No primary script mutation or repeated unchanged full application/Rust matrix was needed for this tooling-only change.

## Remaining gates and next assignment

No real artifact was assessed, mounted, installed, launched or signed. No account, profile, credential, keychain, environment or workflow was changed. The owner still supplies the standard synthetic test account and artifact/signing decisions; the Windows owner still supplies independently accepted A2 source. Frozen candidate bytes, versions, bundle identity and release holds are unchanged.

After required CI, merge and clean Mac synchronization, [Claude prepares the bounded structured study-import contract](CLAUDE_STRUCTURED_STUDY_IMPORT_CONTRACT_PROMPT_2026-10-03.md), as preparation for the selected Zod/react-markdown candidates. Production adoption remains behind the existing foundation gates, accepted import contract and relevant M2 check-in. No library adoption or installed acceptance is claimed here.
