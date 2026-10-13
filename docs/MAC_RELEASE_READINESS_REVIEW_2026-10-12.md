# Mac release readiness review — 12 October 2026

**Verdict: NOT READY for public Mac release.** Accepted source is progressing and its full CI passes. Current-source signed packaging and exact-installer physical verification remain incomplete. This review does not authorize release execution.

## Verified current state

- Accepted main: `3d27ef3a8ef5131895455bd2346b4f7e0ce20239`; application version remains **0.5.3**, shipped database ceiling **14**.
- [Latest main CI](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/38344519832) succeeds at that exact head. The job actually executed frontend tests/build, Rust formatting/lint/tests and lockfile checks; it was not the lightweight documentation path. No duplicate full matrix was run for this assessment.
- M3 production is integrated. Practice-history and Notes date source fixes are integrated. [PR #152](https://github.com/rickydeleon49-ui/Flight-training-/pull/152) is open with passing required CI for `d02a4aab29afac28e4b06e461fd603ab1cf97e92`; it corrects test time-zone assumptions and does not change production behavior.
- The historical v0.5.3 Mac draft remains unpublished, targeting `41464607ff85d0a4cf0b837c19b400d8392dfec4`, created September 29. Its DMG SHA-256 is `de81be50122275104ca9e6791162a7bac6cd43a672c5580d5fbc509b5d16efec`. Its source and bytes are not the current M3/schema14 release.
- [October 11 installed evidence](MAC_INSTALLED_RESULTS_2026-10-11.md), merged through PR #142, covers synthetic **schema12→13** candidates in the separately authorized administrator-account lane. It demonstrates substantial split/upgrade/backup behavior, but not a current schema14 installer. Its original strict-restore and malformed-date FAIL receipts are preserved; subsequent source fixes are not physical retests.
- The accepted signing proposal is still inactive; active packaging workflows do not implement its Developer ID/notarization lane. Read-only local identity inspection returns **0 valid code-signing identities**. This checks the local keychain, not Apple membership or secrets provisioned elsewhere.

## Required release gates

| Gate | Current result | What closes it |
| --- | --- | --- |
| Distinct version/source identity | Unselected in current accepted configuration; repository still says 0.5.3 | Select a new version and exact accepted source; preserve the frozen old draft. |
| Signing lane and credentials | Accepted proposal exists, active lane unavailable/unverified | Approve and configure the Developer ID/notarization lane securely, then verify actual candidate signatures/notarization. |
| Current candidate | No current-main release candidate identified in the reviewed GitHub packaging/draft records | Build one private candidate; record source, run, version, filenames and full hashes. |
| Installed current-schema verification | No accepted schema14 exact-installer results found | Install the exact intended candidate on an authorized isolated Apple Silicon lane; verify launch, relevant features, upgrade over populated data and older-backup restore. |
| Remaining recovery/platform checks | Standard-account isolation and mid-save recovery remain unverified; signing/Gatekeeper release acceptance remains open | Record actual evidence or separately reviewed, explicit scope decisions; deferred tests are not PASS. |
| Publication | Not authorized by this review | Owner authorizes publication after the applicable candidate gates pass. |

Requirements come from the [release review process](RELEASE_REVIEW_PROCESS.md), [accepted signing preparation](MAC_RELEASE_PREPARATION_ACCEPTANCE_2026-10-04.md) and [conditional release continuation](MAC_RELEASE_CONTINUATION_PROMPT_2026-10-04.md). The exact bytes published must be the bytes tested; a later rebuild requires its own verification. The owner-deferred hfdtest run is not automatically resumed here.

## Engineering follow-ups and scope

Schema14 verification preparation remains unmerged/unaccepted on current main. The saved local continuation records proof/inventory corrections still needed; it is not independently verified completion evidence. The live schema13 helper still has the documented fail-closed `__proto__` metadata omission, assigned to that preparation task. Finish its reviewed current-schema evidence or provide an equivalent reviewed verification route before claiming those checks complete. PR #152's test-only correction needs normal review/integration; it is not evidence of a broken application date conversion.

Two GitHub dependency alerts remain open: [source-map-js](https://github.com/rickydeleon49-ui/Flight-training-/security/dependabot/2), high severity/development dependency, and [glib](https://github.com/rickydeleon49-ui/Flight-training-/security/dependabot/1), medium severity. Triage them without assuming both are Mac runtime defects: an offline locked dependency query for `aarch64-apple-darwin` has no dependency path to glib. No exploit in the Mac app is established by this review.

M4 remains an unshipped evidence prototype. Its pending R28–R32 corrections do **not** have to block a release containing only accepted current features. Do not add M4 production or a new dependency to the release simply to finish the roadmap.

For an owner-only unsigned test build, the signing boundary differs from public distribution, but a current-source candidate and an authorized isolated test plan are still needed. The old draft cannot be silently replaced or described as the current version.

## Next action and review limits

Continue the existing schema14 preparation/maintenance work; review/integrate the results. Then resolve the version/signing decisions, produce one private candidate and test that exact installer. Publish only after the applicable release gates close.

This assessment inspected current GitHub source/PR/CI/release records, release policies, active workflows, local signing identities and target-specific dependency metadata. It performed no builds, installs, launches, profile/database access, signing, workflow dispatch or release mutation. The dirty primary roadmap/continuation work and other agents' checkouts were preserved. This report is a current-state review, not a new competing implementation assignment.
