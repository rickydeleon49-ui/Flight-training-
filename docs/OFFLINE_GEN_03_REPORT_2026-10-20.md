# GEN-03 implementation report — 20 October 2026
Codex implementation only, uncommitted; Claude owns review, outside-sandbox gates, mutation checks and merging.
Packet v1 unchanged; no migration, dependency, command, PDF attachment, real data or provider call.

| Parity after import/reopen | Browser sql.js | Native shared fixtures |
| --- | --- | --- |
| PDF-kit summary/section bodies, card fronts/backs, stems/options/correct indexes/explanations, counts | Exact normalized | Exact normalized |
| 03b handwritten + edited question wording, guide/cards and imported provider/model | Exact normalized | Exact normalized |
| Guide-only / cards-only / test-only | Pass | Pass |

V1 deliberately loses PDF bytes/page links, per-item authorship/identities/source offsets, attempts/history and generation state. Guide sourceNotes survive; source.note is preview-only.
Retry/restart proofs replay the same prepared operation after durable reopen: no duplicate material/version. The UI preview itself is not restored on restart; a new preview still creates a new material.
Actual gap: PDF provenance was appended to guide/card/answer text. `failing-first-packet-runner.txt`: 5 failed / 7 passed before the fix. Export now keeps study text exact and discloses the sender in source.note only. No TS/native normalization defect was demonstrated.
Existing rollback, retry, refusal and handwritten parity passed without storage changes. Cards-only preview now truthfully shows no guide. Instructor corrections remain excluded by default.
Exact strings: “Imported from a study packet. Please check it against your PDF and current guidance.”; “Pulled from a PDF on the sender's Mac”; “Add to my Study Library”; “Page links and per-item ‘edited by’ details don't travel in a study packet.”
Named tests: all_three_parts_export_import_reopen_match (both engines), guide_only_cards_only_test_only_roundtrip, 03b_versions_attempts_unchanged_on_import, pdf_kit_packet_labels_no_ai_claim, receiver_without_pdf_has_no_false_links, import_commit_ack_crash_idempotent, import_midwrite_failure_rolls_back_every_part, oversize_credentials_rejected, instructor_content_excluded_by_default, export_dialog_counts_and_fidelity_note, import_preview_counts_before_add.
How-to: [STUDY_PACKET_HANDOFF.md](STUDY_PACKET_HANDOFF.md). ROADMAP owner decisions / AGENTS Gemini gotchas updated; schema-14 manifest and checksums rebound.
All receipts use Node 22 / prescribed Cargo environment and receipt runner; Vite runner loader only after EPERM. Default waits, parallel Cargo, no timeout overrides.
Schema helper: sandbox pgrep emits stderr before its expected refusal (25/26); reviewer must rerun outside sandbox. No installed/browser-walkthrough/CI/release claim.
Initial UI receipt includes one actual disclaimer gap and one faulty count query; the latter is not product evidence. Initial typecheck UUID inference and zero-match Rust filter are corrected. See [evidence notes](evidence/offline-gen-03-2026-10-20/README.md).

| Receipt in docs/evidence/offline-gen-03-2026-10-20 | EXIT | Count |
| --- | --- | --- |
| build-initial.txt | 1 | no test count |
| build.txt | 0 | no test count |
| cargo-lock.txt | 0 | no test count |
| cargo-test-1.txt | 0 | 978 pass / 0 fail / 11 ignored |
| cargo-test-2.txt | 0 | 978 pass / 0 fail / 11 ignored |
| clippy.txt | 0 | no test count |
| diff-check-initial.txt | 0 | no test count |
| diff-check.txt | 0 | no test count |
| failing-first-packet-runner.txt | 1 | 5 failed / 7 passed (12) |
| failing-first-packet.txt | 1 | no test count |
| failing-first-ui.txt | 1 | 2 failed / 34 skipped (36) |
| fmt.txt | 0 | no test count |
| focused-frontend-final.txt | 0 | 161 passed (161) |
| focused-frontend.txt | 1 | 1 failed / 160 passed (161) |
| focused-native-save.txt | 0 | 54 pass / 0 fail / 0 ignored |
| focused-native.txt | 0 | 0 pass / 0 fail / 0 ignored |
| manifest-rebind.txt | 0 | no test count |
| native-fmt.txt | 0 | no test count |
| npm-test-1.txt | 0 | 4282 passed / 6 skipped (4288) |
| npm-test-2.txt | 0 | 4282 passed / 6 skipped (4288) |
| schema14-checksums.txt | 0 | no test count |
| schema14-helper.txt | 1 | pass 25 / fail 1 / skipped 0 |
| typecheck-initial.txt | 2 | no test count |
| typecheck.txt | 0 | no test count |

SHA256 for all changed source/docs and every receipt, including this report: [SHA256SUMS](evidence/offline-gen-03-2026-10-20/SHA256SUMS). The inventory excludes only itself.
Source/docs hashes (the report's own hash is in that inventory):

- `AGENTS.md` `20ec30c67d00972c1a1a3b0931100e410101c7ce544e6960690fa5cbc59b780e`
- `ROADMAP.md` `dcfab0d2ee0e53d31fc943848095cd6af5d9402d49ba8e141fdccb81fa9c582a`
- `docs/STUDY_PACKET_HANDOFF.md` `d2918c9e5829d9e0f436c5eb0b52201cecb11d4d49061a32a49023c91e60c662`
- `docs/evidence/mac-schema14-completion-2026-10-15/SHA256SUMS` `2b690b78efc990f0b3c54aa582c5ce1acdf5da838f67d58e593db5a8d66f6291`
- `docs/evidence/mac-schema14-completion-2026-10-15/source-manifest.json` `77ca09346cb7bb8b78f4cc123ba072ccb4ea79e93684d86af7282a348a665f3e`
- `src-tauri/fixtures/import-contract/gen03-handwritten-operation.json` `b5b95826557f91c03eabab0ccbaf4b7a82866c2741379ef46a5d6d75d67d940e`
- `src-tauri/fixtures/import-contract/gen03-operation.json` `3217b585c93f51d9ee8fa362a359ecd273d245d0da64409b16a3b8c15ec99653`
- `src-tauri/src/study_packet_save_tests.rs` `ce0d090d9b7bc4be40b91a3899bee198601b754905ddcf8f05fd9f540b9a2f25`
- `src/data/pdfStudyKitDraft.test.ts` `d45cc2fce6ac57b8e8e8928ec34cb3901f3ef17e6e040aae9945d8b0542cff74`
- `src/data/studyPacketHandoff.test.ts` `9bf28d94bc97acf1c8bfd2929c9c8bc20e1f15df07532656e3bec41ffb79dfce`
- `src/logic/studyExport.ts` `0716567c2759702024692f7d7e21ab72d0d51bdde470e598715a237aff8dca40`
- `src/pages/StudyLibrary/ExportStudyDialog.test.ts` `f85dc43998cfa2d06fc788210386b2e2d132741b42154a3aace3581f14ae0865`
- `src/pages/StudyLibrary/ExportStudyDialog.tsx` `076a302c7d8bbe5a6c2050bac042367493ec5c79e1ad935ae589e774aed0336d`
- `src/pages/StudyLibrary/ImportStudyPacketDialog.test.ts` `386dd76a80caf69f5c2df11020ff4d57297eab4daf45b4918baef8dc722b3bf0`
- `src/pages/StudyLibrary/ImportStudyPacketDialog.tsx` `8d19dd93ea0a410a1476c7b8437b66bdace1e959876f2fe35597f16ca4bf43df`
