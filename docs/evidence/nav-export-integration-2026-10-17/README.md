# Combined navigation/export integration evidence

Source acceptance: [integration report](../../NAV_EXPORT_INTEGRATION_ACCEPTANCE_2026-10-17.md). Next task: [approved lesson brief](../../P54_05_LESSON_BRIEF_IMPLEMENTATION_PROMPT_2026-10-17.md).

One sequential9-stage local gate, all exit0:3,563 frontend/6 skips; typecheck; web production build;531 native library cases/6 ignored; strict all-target Clippy;fmt;Cargo-lock;helper26/26;staged hygiene. Node22 and scoped SDK26.5. gate.json records exact commands/exits/times; every stage has raw log/exit. source-reconciliation.json compares feature files with reviewed heads: only the two shared integration points differ; source-hashes.json binds all changed application/script inputs against accepted main3e59d71. No application source changed after this gate.

Post-report helper/hygiene receipts verify the refreshed metadata separately. Final CI and merge identity are recorded on the containing PR193; acceptance is conditional on that exact head passing required checks. All15 Claude acceptance members were verified from Git before PR203 merged into export. Prior review/failure packs are preserved and not relabeled.

SHA256SUMS is relative to this directory and excludes itself. Manifest publication is verified using staged/committed Git blobs. Raw logs are preserved byte-for-byte with exact-path attributes. No app launch, real/test profile, provider, installer, signing or release action. Installed save/print/reader behavior and Windows remain separate evidence boundaries.
