# Mac A2 verification correction re-review — 4 October 2026

**Decision: accept MVER-R1's test behavior; request one documentation/publication correction pass before integration.** No production defect was found. A2's accepted production source remains accepted. The Mac verification report and new test remain uncommitted in the implementer checkout. [Focused Claude prompt](CLAUDE_MAC_A2_VERIFICATION_FINAL_EVIDENCE_PROMPT_2026-10-04.md), [review evidence](evidence/mac-a2-verification-rereview-2026-10-04/README.md).

## Independent checks

Reviewed `/Users/rickymac/code/Flight-training-pr70-integration`, branch `claude/mac-a2-verification-2026-10-04`, HEAD `1efc052391ed96bdf1af17294f9ddc71960fc906`. All **29 handoff file sizes and SHA-256 hashes match**. All **15 original-log / publishable-text pairs are byte-identical**. Production code, dependencies and configuration are unchanged. Of the 24 accepted source blobs, **23 remain identical**; the sole expected difference is the 83-line addition to `src-tauri/src/documents_save_tests.rs`.

Codex independently ran the native save suite on the host using disposable synthetic Profiles: **21 harness passes, 20 exercised cases and one explicit distinct-case early return, exit 0, harness 5.42 seconds**. The Mac case-alias regression executes and passes; it checks canonical identity plus device/inode, four delete/trash alias refusals, preserved bytes/hash, references through fresh connections and empty trash. The Windows case is preserved. MVER-R1 is closed as a source/native regression finding, subject to final integration.

Scoped cargo formatting and tracked whitespace checks pass (exit 0). New-file checks additionally find six EOF whitespace diagnostics, listed below. Codex did not repeat the full frontend/Rust matrices, mount another disk image, launch an app, touch a real profile, call Gemini, sign or publish an installer. The implementer's case-sensitive log supports 20 exercised cases plus one explicit alias-capability early return; Codex inspected that receipt rather than re-performing its mounted-volume run.

## MVER-R2 remains — P2: three incorrect hashes and ambiguous snapshot claims

`docs/MAC_A2_VERIFICATION_2026-10-04.md:35` and evidence `README.md:43` list incorrect full SHA-256 values for `src/perf/studyLibraryScenarios.test.ts`. Correct identities independently computed from source and the unchanged accepted manifest are:

| Representation | Bytes | SHA-256 |
| --- | --- | --- |
| Mac working bytes | 13,773 | `7d77d92cb1e107167bcda8d3c6d4e108846bb736019e5f21c621b790f7090acb` |
| Full CRLF reconstruction | 14,073 | `b365b4f6d9cbbbe28a53637dd42071c1299d8534fc6dae3515f259d49facbcf6` |
| Accepted Windows working manifest | 14,028 | `663c385cf4ea5fff9877c0a309d5d1706e26fedaedf9aebd94c3f4e070c58740` |

Accepted Git blob `7140950205dec1b2c55a6de0a1aaeaea05c6b5ea` still matches. This is a documentation defect, not source drift. Recompute/copy complete hashes; never invent the suffix from an abbreviated hash.

The report/README source sections and tracker prose still present 24/24 current matches and say source files remain unmodified. Label that as the **pre-edit baseline** (nine direct, 14 CRLF, one unresolved), then separately describe today's **23 unchanged blobs plus one expected test-only addition**. Likewise label the provenance's clean checkout as the starting state; the submitted checkout is dirty by design. No source/manifest edits are requested.

Finish these receipt details in the same pass:

- `results.json:135` records historical host permanent contention as 5200.0 ms; the retained receipt measures **5203.948333 ms**. Correct it or explicitly label rounding.
- `docs/MAC_PARITY_CHECKLIST.md` MAC-11 still says **456 ms**, inconsistent with the retained historical run (469.290916 ms) and corrected run (465.168375 ms). Use the identified retained run or omit unnecessary timings.
- New focused receipts show harness durations **0.04 seconds on host** and **0.05 seconds on case-sensitive APFS**. The reported 1.11/0.22 seconds combine compilation and harness summaries; they are not recorded wall-clock measurements. Separate build and test durations or label derived estimates. Uncorroborated start timestamps should remain implementer-reported, not captured measurements.
- New outside-checkout text/JSON receipts are also separate invocations, at **21:01:04.154Z** and **21:01:04.378Z**. They agree on 9 PASS/3 UNVERIFIED/3 USER_ACTION but are not a single generated snapshot. Label them separately, or derive presentation from the retained JSON without rerunning. Treat the historical redirection explanation as implementer-reported unless exact earlier command/state evidence substantiates it.

Historical pipeline exits are now clearly labeled implementer-reported; new native test logs capture actual `EXIT=0`. Keep that improvement. No repeat of the full matrix is requested.

## MVER-R3 publication cleanup — P3: tracked-only whitespace misses six new receipts

The 15 mirrors and supplied 29-file hashes resolve the original missing-receipt/handoff inventory problem. They are publication candidates, not already Git-tracked files. `git diff --check` overlooks untracked additions. Read-only no-index checks flag extra blank lines at EOF in:

- `a2-diagnostics.txt`
- `case-sensitive-apfs-save-tests.txt`
- `focused.txt`
- `gate-02-npm-test.txt`
- `gate-06-cargo-test.txt`
- `host-apfs-save-tests.txt`

Trim terminal extra blank lines only in these publishable copies, preserving original `.log` bytes. Record original and copy byte sizes/hashes and the exact EOF-only transformation; retain zero-transform claims only for the remaining nine pairs. Refresh receipt tables and the final handoff inventory. Check new files using no-index whitespace validation without staging someone else's checkout; exit 1 can simply mean files differ, while whitespace produces diagnostics.

## Next step and release boundary

Claude makes this single evidence-only correction pass, leaving the already passing Rust test unchanged. Codex then reviews the bounded document diff for integration and required CI. The owner has asked to prioritize a Mac build they can test. After source evidence integration, the next work should be current-candidate packaging and the installed-account/signing preparation, subject to actual owner prerequisites. The M2 check-in waiver remains effective; no new check-in, Slice B, production feature, provider call, installed launch, release version or publication is authorized by this review.
