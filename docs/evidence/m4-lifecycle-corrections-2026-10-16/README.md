# M4 lifecycle corrections evidence

Codex is the implementer for this round at the owner's request. Pending independent review; no self-acceptance or merge.

The four application/test inputs are frozen in source-hashes.json. Raw receipts retain the first focused harness failure (nested React19 StrictMode does not replay root effects) separately from the corrected root-StrictMode run. No production condition or expectation was weakened. Existing frozen diagnostic bytes were copied unchanged beside their modules, run and removed. Their original failing receipts remain under the earlier review directory.

Local final: 94 focused tests, 4 frozen tests, 3,488 full frontend tests / 6 skipped, build/typecheck, schema14 helper26/26, fmt, cargo-lock and hygiene passed. No unhandled-error summary occurred. No new native build was run: Rust inputs are byte-identical to published PR189 c234005 with green CI38988724371 (517 Linux Rust tests; this is reused CI evidence, not a new Mac result). New exact-head CI and independent source review remain integration prerequisites.

No profile, app launch, installer, key, provider, signing or release operation occurred. SHA256SUMS inventories every other file in this evidence folder.
