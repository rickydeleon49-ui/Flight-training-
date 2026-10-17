# P54-04 save recovery evidence

Codex implemented this correction at the owner's request; independent review required. Source-hashes.json freezes the three changed source/test files. ui-before.log retains2 reproduced UI failures against PR193; final full frontend includes4 new cases and passes3,320/6 skipped. focused-ui-final.log predates the fourth validation-refusal case and contains35 tests; no claim it includes that case. focused-native.log has13 pass; full native has490 pass/6 ignored. Final8-check sequential gate exits are in gate.json and individual raw receipts. Native tests use SDK26.5, Node22 for frontend. No profile, app launch, native installer, provider, key, signing or release operation.

The speculative Windows cleanup-leak finding was retracted after checking Rust's default FILE_SHARE_DELETE behavior; no Windows defect or Windows runtime pass is claimed. The existing cleanup guard is preserved. Native changes add a private persistence callback for partial-write/flush/unwind/actual-rename-failure injection and correct the forced-termination cleanup overclaim. No runtime/environment bypass, dependency, migration, capability, or version change.

SHA256SUMS inventories all other files here. Earlier PR193/191 failures and reports remain unchanged.
