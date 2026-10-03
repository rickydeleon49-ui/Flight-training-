# Independent Mac readiness preparation review — 3 October 2026

**Historical outcome: corrections required at this first review. R1–R4 are now [closed by independent re-review](MAC_INSTALLED_READINESS_ACCEPTANCE_2026-10-03.md).** The findings and original evidence below are preserved. Claude has implemented new read-only Mac tooling and a runbook, but four findings below prevent acceptance. Codex reviewed actual files, independently reran the focused gate and reproduced seven mismatches. Claude retains implementation ownership. [Detailed correction prompt](CLAUDE_MAC_READINESS_CORRECTION_PROMPT_2026-10-03.md).

## Scope and source identity

Reviewed the ten-file handoff on local branch `codex/mac-installed-readiness-preparation`, based on `8b159485a66804a368dde5f4d7eea596b63bbfcc` (PR #54). All ten SHA-256 hashes exactly matched Claude's handoff before review; see the [receipt](evidence/mac-installed-readiness-review-2026-10-03/review-receipt.txt).

The implementation remains uncommitted in the primary Mac clone. This publication contains review documents and inert evidence snapshots only, prepared in a separate review worktree to preserve Claude's dirty branch. It does not add the preflight or its tests to executable project paths. [Reviewed script snapshot](evidence/mac-installed-readiness-review-2026-10-03/reviewed-preflight.mjs.txt), [test snapshot](evidence/mac-installed-readiness-review-2026-10-03/reviewed-tests.ts.txt) and [runbook snapshot](evidence/mac-installed-readiness-review-2026-10-03/reviewed-runbook.md.txt) allow other agents to inspect the exact inputs. References below are one-based lines in those reviewed files.

## Confirmed findings

### READINESS-R1 — P2: signature PASS does not verify integrity and conflates the app and DMG

References: `scripts/mac-readiness-preflight.mjs:177–196,474–481`; `src/logic/macReadinessPreflight.test.ts:208–218`.

The tool invokes `codesign -dv --verbose=2`, then marks A-SIGNATURE PASS from displayed certificate/runtime/team/timestamp fields. It never invokes signature verification. A tampered bundle can retain those metadata fields. The independent injected case supplies intact display metadata and a failing strict-verification response: A-SIGNATURE is PASS and verification calls are zero. A second case gives the display command exit 1 with the same fields and also gets PASS, because `parse.codesign` accepts a nonzero command when an Identifier line exists.

The same runtime predicate is used for a disk-image file. The DMG case with Developer ID metadata, timestamp and no app runtime flag yields FAIL solely because the container lacks that flag. Apple's packaging example signs the disk image separately with timestamp and identifier; the inference is that an application-runtime requirement cannot be used as the disk-image-container verdict. [Apple DTS packaging example](https://developer.apple.com/forums/thread/701581).

Correction: distinguish displayed identity, verified integrity, application runtime requirements and container signing. No integrity PASS without a successful bounded verification command. Failed commands cannot be promoted by parseable output. An app's signature identifier should agree with its expected bundle identity. A DMG observation cannot certify its unopened inner app. Keep Gatekeeper and stapler opt-in. Apple documents strict verification separately from display. [Apple TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html).

### READINESS-R2 — P2: SDK presence is reported as compatibility

Reference: `scripts/mac-readiness-preflight.mjs:379–399`.

H-SDK becomes PASS whenever `exists(sdk)` is true. It does not require readable SDK metadata or a verified supported version. An explicit or inherited SDKROOT selecting the documented incompatible 27.0 SDK therefore produces PASS and the summary “explicit compatible SDK present.” A second independent case with the directory present and SDKSettings.json absent produces the same PASS with version unknown.

Correction: separate presence/version observations from compatibility. Use the project's narrowly evidenced SDK prerequisite, and classify other or unreadable versions as FAIL or UNVERIFIED with an accurate reason. Do not certify a new SDK without evidence or run a build in this task. Handle malformed SDK metadata, wrong file type and failed observation commands without manufacturing PASS. Broader OS/configuration checks should also validate inputs before comparing them.

### READINESS-R3 — P2: alphabetic command output can escape the privacy filter

References: `scripts/mac-readiness-preflight.mjs:182,201–204,529–537`; `src/logic/macReadinessPreflight.test.ts:254–274`.

Authority and assessment source parsers validate character shapes rather than fixed semantic categories. Adding `Authority=Private Sentinel Person` to otherwise healthy display output publishes that complete synthetic certificate common name in `authorityKinds`. Setting `source=Private Sentinel Person` publishes it in the Gatekeeper source field. Both cases independently reproduce. Final replacement of this Mac's home and username does not remove a different certificate holder or an unexpected alphabetic secret.

Correction: map known authority and assessment categories to fixed output values and emit a fixed unknown category for other strings. Audit receipt fields and CLI errors for similar unrestricted output. Add positive controls retaining useful known categories, plus alphabetic and punctuation-bearing unknown sentinels. Assert absence in the complete JSON, human output and error output. Do not solve this by broad regex stripping that silently corrupts receipt values.

### READINESS-R4 — P2: the installed runbook stops on an expected first-open confirmation

Reference: `docs/MAC_INSTALLED_READINESS_PREPARATION_2026-10-03.md:235`.

Phase 1 says “Any Gatekeeper prompt or refusal: record it and STOP.” That rejects the normal downloaded-from-the-Internet confirmation for an identified developer. Apple explicitly says first opening such an app prompts for confirmation. This contradicts the intended normal installation/first-launch test and can stop every dependent phase on a healthy signed candidate. [Apple Support: safely open apps](https://support.apple.com/en-us/102445).

Correction: classify normal confirmation separately from security refusal. In a later explicitly authorized installed test, record the normal confirmation and proceed through its ordinary Open button only when artifact identity and prerequisites match. Unknown developer, cannot-check, damaged/malware, revoked-signature and policy refusals remain stopping conditions. Keep Open Anyway, quarantine removal and Gatekeeper bypass excluded. Document any owner-mediated installation authentication separately; never request an administrator password in chat or elevate the test account.

## Additional signing-plan clarification

The repository was independently observed to be private and owned by a user account. The proposed `macos-signing` environment assumes required-reviewer approval is available. GitHub documents that required reviewers on Free, Pro and Team plans are available only for public repositories. Account plan/feature eligibility was not established in this review. Therefore make the recommendation conditional and provide an owner-reviewed alternative if that protection is unavailable; do not claim that a named environment alone establishes the gate. [GitHub deployment protection documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

No environment, secret, credential or workflow was created or inspected for contents. This is a planning correction, not a claim that the owner's actual plan lacks the feature.

## Independent verification and limits

| Check | Codex result |
| --- | --- |
| Ten handoff hashes | 10/10 match |
| Focused new preflight and unchanged release-safety suites | 68 passed, 1 deliberate skip; exit 0 |
| Typecheck | exit 0 |
| Independent injected diagnostic | Seven unmet expectations reproduced; exit 1 intentionally, outside ordinary test discovery |
| Default host preflight | 9 PASS, 0 FAIL, 3 UNVERIFIED, 3 USER_ACTION; exit 0; readyForInstalledUse false |
| Host receipt privacy check | No `/Users/` path in receipt |

Evidence and commands are in the [review folder](evidence/mac-installed-readiness-review-2026-10-03/README.md). The original seventeen tests pass but do not cover these cases. The diagnostic is a hash-guarded characterization of the reviewed bytes, not a corrected-code regression gate; Claude must add tests asserting the desired behavior. No production source was changed by Codex and no temporary production mutation was used.

No repeated unchanged application/Rust matrix or A5 measurement. No real Developer ID artifact was inspected, altered, signed or launched. No DMG was mounted. No account, profile, keychain or signing settings changed. A2 production source, the dedicated test account and signing decisions remain pending. macOS 12, installed behavior and release readiness remain unverified. Selected open-source packages and M2 remain unimplemented.
