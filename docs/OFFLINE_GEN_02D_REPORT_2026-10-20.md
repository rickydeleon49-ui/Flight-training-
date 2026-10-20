# GEN-02d implementation — 20 October 2026
Implemented by Gemini (gemini-3.8-flash) as requested. Base `24df288` (PR #243), branch `codex/offline-gen`; uncommitted for Claude review.
Implements the generate-later queue: she asks now; native hashes PDF and freezes section plan with zero network; runs when she says Start now.

Files and SHA256:
- `src-tauri/src/gemini.rs`: `670f47c3a8731f3c6022d07941d28f523a337a1356692a6b81bff62eae917f5e`
- `src-tauri/src/gemini_jobs.rs`: `2d6368ef7eb0c42c68c9504ba8a140c7f86e9f09f40391d4736b28b62a66921e`
- `src-tauri/src/gemini_sections.rs`: `47bf3fa6f3dd5ee290d9c41fb4723ba43662bbac179115bb8d1701ed574e8804`
- `src-tauri/src/gemini_sections_tests.rs`: `8104ac05cbc27fd6205b3160777a31b7e03d1c290ff245aa5748e06623d65318`
- `src-tauri/src/lib.rs`: `56ffc0e0d13eed9e6157d7fc1796cba12eeba08631a53a09aad2c973ef9b0891`
- `src/components/ui/Dialog.tsx`: `1153f3731dbaef86df4d324272a920b9d4c2a544aac7d67bf7e7283f852b106d`
- `src/pages/StudyLibrary/GeminiJobNotice.tsx`: `5755430181eefd0424ff4da4ba3a356e4ca87abb7b5dcb0f12fec0beb2f72c59`
- `src/pages/StudyLibrary/MaterialDetail.tsx`: `4b260a754f72df31b77118c2be212d0cdbfd347bac46ec65bb9b7db261e1ce56`
- `src/services/gemini.ts`: `47ad87ad2a201b7bbf8d5e87ea3d039ef95387f2820a29d8996cdc7f95dbca48`
- `src/state/GeminiJobs.tsx`: `0ec3c5c83e2f0da0cf3111223f2a9c42b3c07a37e3ed05b1bdf50b6322e05186`
- `src/pages/StudyLibrary/GenerateLaterQueue.test.ts`: `5f8609fdd8d437ea1a5cd42f2f3b6735a7149a3e3b164e1c5c1ceb55f9a5fbf7`

Gate receipts: `docs/evidence/offline-gen-02d-2026-10-20/`:
- `focused-native.log`: EXIT 0 (42 passed, 0 failed, 880 filtered out; 6/6 new queue contract tests pass)
- `focused-frontend.log`: EXIT 0 (6 passed, 0 failed; GenerateLaterQueue.test.ts)
- `cargo-test-1.log`: EXIT 0 (939 passed, 0 failed, 11 ignored; full suite, default parallel mode)
- `cargo-test-2.log`: EXIT 0 (939 passed, 0 failed, 11 ignored; full suite, default parallel mode)
- `fmt.log`: EXIT 0 (cargo fmt --manifest-path src-tauri/Cargo.toml --check; clean)
- `clippy.log`: EXIT 0 (cargo clippy --locked --all-targets -D warnings; clean)
- `cargo-lock.log`: EXIT 0 (git diff --exit-code src-tauri/Cargo.lock; clean)
- `typecheck.log`: EXIT 0 (npx tsc --noEmit; clean)
- `npm-test-runner.log`: EXIT 0 (197 files passed, 4 skipped; 4148 tests passed, 6 skipped)
- `build.log`: EXIT 0 (npm run build -- --configLoader runner; clean)
- `diff-check.log`: EXIT 0 (git diff --check; clean)

User-facing strings:
- `"Generate later"`: Button in the "Send this file to Google?" confirmation dialog and in offline notice.
- `"Waiting for you to start. Press Start now when you have a good connection."`: Status message for queued guide.
- `"Start now"`: Button to run a queued guide via resume_study_guide.
- `"Cancel"`: Button on queued guide notice to remove waiting item without network.
- `"{total} sections planned"` / `"{total} section planned"`: Planned section count with material title in notice.

## Correction r1
Fix: Journal::open resets only "running"/"paused" to "waiting-for-her", keeping "cancelled"; UI routes cancelled draft to SectionGuideNotice ("Stopped. Your finished sections are kept.").
Failing-first: failing-native.log EXIT 101 (WaitingForHer != Cancelled); failing-frontend.log EXIT 1 (waiting copy offered instead of stopped copy).
Gate: focused-native.log EXIT 0 (43 passed); focused-frontend.log EXIT 0 (7 passed); cargo-test-1.log / cargo-test-2.log EXIT 0 (940 passed, 11 ignored); fmt.log EXIT 0; clippy.log EXIT 0; cargo-lock.log EXIT 0; npm-test.log EXIT 0 (197 files, 4143 passed, 6 skipped); typecheck.log EXIT 0; build.log EXIT 0; diff-check.log EXIT 0.
Changed files and SHA256:
- src-tauri/src/gemini_jobs.rs: 9805d7b2a61045d997b7e65330e17cc0dab253401abedbf3fb8f995ebfd0356a
- src-tauri/src/gemini_sections_tests.rs: 697d5ba7b28959b0f9f729b0a2557cae906b54f00f07284078b6c5d97f1e02be
- src/state/GeminiJobs.tsx: aea446e8987684f5ae0f0558de2c7c6c3de262aa35c23c681ca40cbd3b4114b5
- src/pages/StudyLibrary/GeminiJobNotice.tsx: 714ac655f417316ea37dde217a528117893b89802944f4d40457a94b5387e20c
- src/pages/StudyLibrary/GenerateLaterQueue.test.ts: ef33991e9f18c3fa47ef422afee5eaf546a025dc36d0236fc772eedecdcc2a54

## Correction r2
Added running_and_paused_queue_items_wait_for_her_after_reopen: running/paused become waiting-for-her, cancelled draft unchanged, zero loopback requests. Retry-cancel bound is 1,400 ms with a comment explaining it remains below the 1,500 ms minimum pause; all other assertions unchanged.
launch-reset-mutant.log EXIT 101 (0 passed, 1 failed); production launch-reset line restored byte-for-byte.
sections.log EXIT 0 (44 passed, 0 failed); cancel_flow.log EXIT 0 (16 passed, 0 failed).
cargo-test-1.log and cargo-test-2.log each EXIT 0 (941 passed, 0 failed, 11 ignored), default parallel mode.
fmt-before-fix.log EXIT 1 (one assertion line wrap); fmt.log EXIT 0 after whitespace-only fix; clippy.log EXIT 0 (both runs, -D warnings); diff-check.log EXIT 0 (all runs).
src-tauri/src/gemini_sections_tests.rs SHA256: 79405e3bf264940fa1f7fe235792018576dd09b88ccd76cd798b49fd7d48ee5e
src-tauri/src/gemini_cancel_flow_tests.rs SHA256: 3207cbded8ae6a0ea1e5176c247a46340c85fb7d7b30966c0703e1d111a9b958
Receipts: docs/evidence/offline-gen-02d-2026-10-20/correction-r2/. Loopback only; all prior GEN-02d/r1 work preserved; everything uncommitted.
