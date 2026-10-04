# Independent Mac A2 verification review evidence — 4 October 2026

[Review](../../MAC_A2_VERIFICATION_REVIEW_2026-10-04.md), [Claude correction prompt](../../CLAUDE_MAC_A2_VERIFICATION_CORRECTIONS_PROMPT_2026-10-04.md).

- `submitted-artifact-hashes.json`: independently frozen 22-artifact current-byte inventory, including 15 ignored logs. Subject remains uncommitted and untouched; these are not implementer-supplied expected hashes.
- `observations.json`: 24 accepted blob comparisons, nine direct/14 CRLF/one unresolved working-byte reconstruction; conditional names; separately observed preflight counts; reviewer checks and corrected toolchain failure.
- `submitted-host-apfs-save-tests.txt`, `submitted-case-sensitive-apfs-save-tests.txt`: publication copies of the current small native logs with terminal blank lines removed only. Original bytes/hashes remain frozen; `publication-copy-receipt.json` records both identities. Host contains one early return; sensitive log does not.
- `submitted-preflight-text.txt`, `submitted-preflight.json`: byte-identical independently generated text/JSON receipts with different source-state counts.
- `case-identity-probe.rs`, `case-identity-probe.txt`: reviewer-only synthetic canonicalization premise control, exit 0. Compile with scoped Rust/SDK and pass a nonexistent task-owned temporary directory; the probe refuses an existing directory and removes only the file/directory it created. This is not the missing native delete/trash regression.

No original submitted receipt or source was modified. No full suite, real app/profile, provider or installed test was rerun. All review publication artifacts are documentation/evidence under docs; subject code/report acceptance remains pending MVER-R1–R3.
