# Mac A2 verification acceptance — 4 October 2026

**Decision: accept the native Mac regression and corrected evidence for source integration; MVER-R1–R3 are closed.** No production defect or production change was found. This acceptance does not certify an installed release. [Frozen submission inventory](evidence/mac-a2-verification-acceptance-2026-10-04/submitted-artifact-hashes.json), [review evidence](evidence/mac-a2-verification-acceptance-2026-10-04/README.md), [implementer report](MAC_A2_VERIFICATION_2026-10-04.md).

## Independent review

Reviewed Claude's uncommitted submission in `/Users/rickymac/code/Flight-training-pr70-integration`, branch `claude/mac-a2-verification-2026-10-04`, base `1efc052391ed96bdf1af17294f9ddc71960fc906`. All 29 submitted sizes and SHA-256 hashes match. All 15 ignored original logs match the prior inventory. Nine publication copies are identical; six differ only by removal of one extra terminal newline. No submitted file produces whitespace diagnostics.

All 24 accepted source entries were compared with the accepted manifest. Twenty-three match; only the expected 83-line test addition differs. Its SHA-256 remains `ce3212f4463e825c4bf5ae4f1c248ed9cf05669a35194728925c7fafefa6e768`. Production source, dependencies, lockfiles, configuration and the original Windows test remain unchanged. Integration starts from GitHub main `2c4c0b14ae80d8aae59709524e5452056939e8b5` and preserves later review/tooling history instead of overwriting it with older tracker files.

The previous independent host native suite passed 21 harness cases (20 exercised plus one explicit distinct-case early return), exit 0. The alias regression actually executes on the host, checks canonical identity and device/inode, rejects all four uppercase/lowercase delete/trash attempts, and preserves bytes/hash, reopened references and empty trash. It is unchanged in this submission; no expensive suite was repeated for documentation edits. The case-sensitive volume's alias-capability early return is honestly reported and is not an exercised alias case.

## Findings resolved

| Finding | Accepted resolution |
| --- | --- |
| MVER-R1: missing native case-alias protection evidence | Permanent host regression reviewed and independently passed in the prior review; unchanged final hash. |
| MVER-R2: source identities, snapshots and timing | Three complete hashes corrected; 24/24 pre-edit baseline separated from 23 unchanged current blobs plus one test addition. Historical permanent contention is 5203.948333 ms. Focused compile/harness times are separate, totals explicitly derived. Text/JSON preflights are distinct timestamped invocations; historical exits and explanations retain attribution. |
| MVER-R3: missing publication receipts / whitespace | Fifteen publishable copies supplied; six EOF-only transformations documented with original/copy hashes. Zero whitespace diagnostics across new and tracked files. |

One minor handoff-only wording error remains: Claude's pasted table calls no-index checks exit 0. Independent checking finds status 1 for ordinary nonempty-file differences, with zero diagnostics. This acceptance records the accurate interpretation; it does not require another implementation pass. The publication docs and gate must not claim a zero no-index difference exit.

Historical full-matrix receipts support 2,348 frontend passes/four skips, 286 Rust passes/six ignores before the Mac test addition, build, formatting, lint, lock/version and 29 Unix helper checks. These are implementer evidence, not newly repeated independent runs. Required exact-head CI on the containing PR must pass before merge.

## Owner direction and release limits

The latest owner direction is: “review and no testing account ill wait for the release.” This supersedes using the earlier account-creation report as an active test prerequisite fulfillment. No account work or app launch is planned. The owner reports no Apple Developer Program membership. Record these facts without inventing account verification, credentials or signing results.

The M2 check-in waiver remains effective. It does not clear installed smoke tests, macOS 12/VoiceOver checks, signing/notarization, exact-artifact release approval, or separate Slice B scoped approval/D1–D9. Existing private draft v0.5.3 is a frozen older artifact and cannot inherit this new source evidence. Windows distribution remains held; v0.5.2 remains retired.

[Claude's next assignment](CLAUDE_MAC_RELEASE_PREPARATION_PROMPT_2026-10-04.md) prepares a current-source Mac release path and concrete reviewable work while keeping unavailable installed/signing outcomes unverified. No release, tag, version change, provider call or owner-profile access is part of this acceptance.
