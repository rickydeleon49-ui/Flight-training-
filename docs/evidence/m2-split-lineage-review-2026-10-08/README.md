# Independent split-lineage scope review evidence

Changes requested: SL-R1–SL-R3. See live review and correction prompt in docs/.

- Original submitted scope/evidence copied verbatim into the scope pack and submitted/ snapshots; six hashes and nine checksums verify.
- diagnostics/lineage-review.test.mjs: two passing controls/five semantic failures on submitted model. Imports the original exported helper; copy/redirect only the import when testing a corrected model with the same behavioral contract.
- receipts/submitted-proof.*: 13 passing node:test cases, exit 0.
- receipts/submitted-controls.*: reported 4/4, exit 0; disconnected-control limitation recorded.
- receipts/diagnostics.*: two pass/five fail, exit 1.
- receipts/actual-mutant-proof.*: actual exported composition formula changed in an isolated scratch copy, actual proof exit 1.
- receipts/actual-mutant-controls.*: same mutant, supplied controls still exit 0 (false sensitivity claim).

Original implementation/planning clones unchanged. No production/full application/installed tests were run. SHA256SUMS is rooted here.
