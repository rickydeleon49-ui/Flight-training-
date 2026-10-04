# Final Mac A2 acceptance evidence — 4 October 2026

The [acceptance report](../../MAC_A2_VERIFICATION_ACCEPTANCE_2026-10-04.md) describes scope and limits. `submitted-artifact-hashes.json` freezes the exact 29-file Claude submission before integration edits, plus 15 preserved ignored original logs. The logs remain local; their reviewed publishable copies are in [the implementation evidence](../mac-a2-verification-2026-10-04/README.md).

Independent final review: 29/29 sizes/hashes match; 15/15 original logs match the previous freeze; nine copies are byte-identical and six remove exactly one terminal newline. All submitted files have zero no-index whitespace diagnostics. Nonempty-file no-index difference status is 1, not a zero exit. The previously reviewed Rust test hash is unchanged. Of 24 accepted source entries, only that test differs. Correct working and CRLF source hashes were independently recomputed. Receipt timing and invocation labels were checked against retained evidence.

This final pass does not rerun full suites. The prior independent host native suite (21 harness passes, 20 exercised plus one explicit early return, exit 0) and its captured receipt remain in [the prior re-review](../mac-a2-verification-rereview-2026-10-04/README.md). Case-sensitive APFS and full-matrix results remain implementer evidence. Required CI for the containing source PR is an additional publication gate.

Integration preserves current-main coordinator history, updates acceptance and owner-direction notices, and copies the reviewed regression and allowlisted publishable evidence. Submitted hashes intentionally identify the pre-integration submission; coordinator-edited documents will have different hashes.
