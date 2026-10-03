# Claude: correct the Mac readiness preflight and runbook

Continue the existing task in `/Users/rickymac/code/Flight-training-`, on `codex/mac-installed-readiness-preparation`, based on `8b159485a66804a368dde5f4d7eea596b63bbfcc`. Codex has reviewed your delivered files and found four confirmed issues. Complete these corrections, meaningful regressions and updated evidence as one coherent handoff. You own implementation and local validation; Codex will independently re-review and handle GitHub integration.

The independent review and this prompt are being published through a documentation-only branch. Your implementation remains uncommitted and unpushed in the Mac clone. Do not reset, switch, stash, rebase or pull over the dirty task branch. If the review publication has merged, fetch/read it without changing your checkout. If GitHub access is unavailable in your session, the same report and prompt will be supplied locally and in chat.

## 1. Confirm the exact starting state

Read `docs/MAC_INSTALLED_READINESS_REVIEW_2026-10-03.md`, its review evidence and the original assignment. Review files may be in the separately published main branch rather than your working tree. Record current HEAD, branch and all tracked/untracked task paths. Confirm that the ten original handoff hashes still match before editing. The reviewed preflight is SHA-256 `b9bd50c1a26a40d0aa052da35a76faae3e35a2c44def494e4610018d3849d8eb`; the test is `59bee8f9e90f58c00a0bcb8c5d75182df27fb5358c1f964a4aad009d5b28c1a3`. Do not overwrite another agent's unexpected changes. Report a specific conflict if one exists and continue unaffected work.

All seventeen original preflight tests pass. Codex independently obtained 68 passed and one deliberate skip with the unchanged release-safety suite, and a passing typecheck. Seven injected review probes expose missing behavior. The published diagnostic is guarded to the old script hash and intentionally exits 1. It is evidence of the old implementation, not a script to force into a passing corrected-code gate. Turn its scenarios into permanent desired-behavior regressions with your injected runner and disposable fixtures.

## 2. READINESS-R1: distinguish display, integrity, app and container

The current script assigns signature PASS from `codesign -dv` output alone and can even do so when that command exits nonzero. Add a bounded read-only verification step, with clear receipt fields separating observed signature identity from validated integrity. Review Apple's verification guidance and the actual command behavior; do not equate printed metadata with validated bytes.

For an explicitly supplied app bundle, a PASS must require successful display and appropriate strict signature verification, the expected signature/bundle identifier, Developer ID Application identity, hardened runtime, team presence and secure timestamp as applicable. A changed or missing sealed resource must not pass. Do not infer app validity from the mere presence of a Sealed Resources line. Missing/denied/timed-out/truncated/unparseable commands should remain accurately UNVERIFIED; an observed integrity failure should be FAIL. Honor exit codes rather than accepting otherwise plausible output from failed commands. Audit the other observation commands for the same error.

For a supplied DMG file, report disk-image signature/integrity separately from the inner application's runtime and metadata. Apple's disk-image packaging example uses Developer ID signing with timestamp and a separate image identifier. Do not require an app Mach-O runtime flag on the container or require its signing identifier to equal the application's bundle ID. Keep the inner app UNVERIFIED because the tool never mounts it. Choose clear check names and document any schema changes or additional fields so existing receipts remain interpretable.

Add controls for healthy verified app, displayed metadata with failed integrity, nonzero display with plausible fields, missing verification tool, bounded timeout and a healthy container without an app runtime flag. Retain ad hoc/unsigned and wrong identity cases. Default execution must not inspect artifacts. `--assess` remains the opt-in boundary for Gatekeeper/stapler checks; local read-only integrity verification must never sign or alter the artifact.

Primary references: [Apple verification guidance](https://developer.apple.com/library/archive/technotes/tn2206/_index.html), [Apple packaging discussion and its current-documentation link](https://developer.apple.com/forums/thread/701581). Consult these for exact commands, separating a technical inference from observed artifact evidence.

## 3. READINESS-R2: SDK existence is not compatibility

The current H-SDK PASS is based solely on `exists(sdk)`. Codex reproduced PASS for SDK 27.0, which the repository records as incompatible with the tested local native build, and PASS when SDKSettings.json is absent and version is unknown.

Separate SDK path presence, readable metadata, identified version and the narrowly evidenced compatible prerequisite. The existing evidence supports explicit SDK 26.5. Another SDK should not receive a compatibility PASS merely because a directory exists. Unknown or unproven versions should be UNVERIFIED, and a known conflicting prerequisite should be FAIL with an accurate reason. Do not run builds or change system developer settings to broaden that evidence.

Cover absent path, non-directory path, missing/malformed/unreadable settings, known 27.0, another unproven version and the actual 26.5 positive control. Exercise both `--sdk` and inherited SDKROOT selection. Ensure synthetic existence checks cannot fall through to real system files; Codex's review fixtures explicitly isolate that seam. Keep the current host/default SDK observations distinct from claims that linking will work. Validate minimum-OS/config values before numeric comparisons and classify malformed inputs honestly.

## 4. READINESS-R3: enforce semantic output categories

The current parsers accept arbitrary alphabetic Authority and spctl source lines. `Authority=Private Sentinel Person` and `source=Private Sentinel Person` both leak the complete synthetic string into the public JSON receipt. Home/username replacement is insufficient for certificate holders, other accounts or secrets.

Map recognized authority/source values to a small explicit set of fixed categories. Unknown values should become a fixed unknown category or be omitted with an accurate observation state. Do not retain a raw name just because it has permitted characters. Review identifiers, branches, SDK metadata, repository policy fields and CLI error paths for similar uncontrolled output, while preserving useful intentional public observations. Keep raw stdout/stderr out of receipts and errors. Never dump environment variables or real credentials.

Add alphabetic sentinels, punctuation-bearing sentinels, a holder unlike the current username and a private path in malformed/error output. Check full JSON, human-readable output and CLI errors, plus positive controls for recognized Developer ID/Apple authority and assessment categories. Avoid indiscriminate string scrubbing that corrupts valid values or receipt JSON. Preserve the per-command timeout, output cap, no-write default and task-owned injected runner.

## 5. READINESS-R4: make normal first launch testable

Phase 1 currently stops on any Gatekeeper prompt. Apple says a downloaded app from an identified developer normally asks for confirmation at first opening. Rewrite the runbook's criteria to distinguish that ordinary confirmation from a refusal. Record exact message/buttons and artifact identity. During a future authorized installed test, the normal confirmation's Open action can continue the phase when prerequisites and identity match; it is not an installed PASS by itself.

Unknown developer, cannot-check, damaged/malware, revoked-signature and policy refusals remain stops. Preserve the exclusions for Open Anyway, removing quarantine, disabling Gatekeeper and bypassing security settings. This correction does not authorize an installed run now. Document installation scope and any owner-mediated authentication needed for a standard account, without requesting passwords or elevating it.

Use [Apple's current first-open guidance](https://support.apple.com/en-us/102445). Review surrounding prerequisites, global stops and the blank receipt for consistency. Use a concise scenario table to make normal confirmation versus refusal clear; do not write a test that only searches for your preferred sentence.

Also correct the signing recommendation: this GitHub repository is private. Required environment reviewers are plan-dependent; [GitHub documents the limitation](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments). Mark private-repository eligibility unverified until the owner establishes it. Provide a conditional CI recommendation and an owner-reviewed local/manual alternative if the proposed gate is unavailable. Naming an environment does not guarantee approval protection. Do not change workflows, environments or secrets now, and do not infer the owner's plan from unavailable information.

## 6. Validate and hand off the corrected package

Keep this scoped to the preflight, its tests and associated preparation docs. Add no library, production app change, migration, signing workflow or open-source feature. Preserve version, bundle identity, Windows holds and the frozen v0.5.3 bytes. A2 source remains with its Windows owner. Keep installed results and macOS 12 UNVERIFIED.

Run focused new/updated controls, the related release-safety suite, typecheck, documentation/link checks and `git diff --check`. Show the new regressions fail against the reviewed old bytes using an isolated temporary copy or fixture, then pass the corrected script. Do not mutate the primary implementation during that comparison. Full unchanged Rust/application matrices and A5 heavy fixtures need not be repeated. A bounded mutation check is useful only where it demonstrates the newly covered behavior, not as an excuse to repeat everything.

Run the corrected default preflight once on this Mac and save a new sanitized receipt with counts, command and exit code. Preserve the earlier host/control receipts as historical evidence. Do not use artifact assessment, mounting, installation, launching, signing, account creation, keychain changes or live Gemini. Synthetic fixtures are sufficient for these corrections. Missing owner prerequisites do not prevent finishing this package.

Update the runbook and usage/schema docs, evidence README, STATUS and project handoff to say corrected and pending independent re-review. Link each R1–R4 to its fix and exact regression names. Include the private-environment clarification. Supply final hashes for every changed file, an exact inventory against the original ten files, commands/counts/exits, old-version failure results, new positive/negative controls, current host observations and their limits. Confirm that the corrected source was restored/verified if any test-copy exercise occurred.

Leave everything uncommitted and unpushed for Codex. Do not start another roadmap task, send the Windows-owner message, provision credentials or perform an installed run. Stop after delivering one complete correction handoff.
