# GEN-FIX-2 implementation — 20 October 2026

Uncommitted on `codex/offline-gen`, built on FIX-1 `4f1c17c`; Claude reviews/tests/merges. GEN-FIX-1 merged (PR #239), confirmed on origin/main at `846ce1f`. Implemented D2: connect 15 s; upload/control/body inactivity 60 s; processing 120 s total; headers 480 s/attempt; validation 30 s; immutable 900 s invocation cap including retries/cleanup. Three generation attempts/nine card submissions retained.
`stage-v1` persists absolute deadline/remainder, active stage and per-stage elapsed/remainder before requests/checkpoints; rollback/reopen cannot replenish time. Legacy and measured-rate drafts stay frozen. Existing counting UploadBody and Response::chunk() retained; no stream feature, dependency or SQL migration.
Evidence: `docs/evidence/offline-gen-fix2-2026-10-20` (E); gate commands use the owner receipt runner. E/SHA256SUMS binds report, changed files and receipts; E/.gitignore exposes raw logs without staging.
Failing first (`failing-first.log`): upload_stall_61s, processing_120s_not_reset_by_polls, progress_cannot_extend_900s, header_grace_not_transfer_stall, restart_clock_rollback, cancel_at_each_stage, cancellation_versus_final_checkpoint_race: 7 genuine failures against FIX-1, before implementation.

| Receipt (.log in E) | EXIT | Counts / finding |
| --- | ---: | --- |
| build | 0 | passed |
| cargo-full-final | 0 | 896 passed / 0 failed / 11 ignored |
| cargo-full | 0 | 896 passed / 0 failed / 11 ignored |
| cargo-lock | 0 | passed |
| clippy-final | 0 | passed |
| clippy | 101 | MSRV 1.77.2 rejected Option::is_none_or; replaced with compatible map_or |
| diff-check | 0 | passed |
| failing-first | 101 | 0 passed / 7 failed / 0 ignored |
| fmt-final | 0 | passed |
| fmt | 0 | passed |
| focused-final | 0 | 230 passed / 0 failed / 1 ignored |
| focused-first | 101 | 216 passed / 6 failed / 1 ignored |
| focused-second | 0 | 226 passed / 0 failed / 1 ignored |
| focused | 0 | 230 passed / 0 failed / 1 ignored |
| helper | 1 | 25 passed / 1 failed: sandbox sysmond/pgrep stderr precedes expected REFUSED; operator still refuses; reviewer reruns outside sandbox |
| manifest-rebind | 0 | 20 manifest entries / 21 checksum entries verified |
| npm-test | 0 | 4,089 passed / 6 skipped; 194 files passed / 4 skipped |
| stage-first-green | 101 | compile failure: UploadBody test fixture lacked new cancellation probe; corrected |
| stage-green | 0 | 7 passed / 0 failed / 0 ignored |
| typecheck | 0 | passed |

S1: both upload-only 360 s and 240 s upload + 120 s thinking succeed; one generation/start/finalize. Same synthetic two-page PDF is whitespace-padded to 32 MiB to expose producer backpressure rather than buffered fake-server reads; timing stays 1:100.
S2: 360 s headers succeeds; 481 s fails in Generating at 480 s, one submission. Existing timeout classification is terminal; no new automatic timeout retry.
S3: 400 s trickle succeeds with every gap below 60 s; a 61 s no-byte gap fails in Reading while absolute time remains.
S4: early partial/drop replays the whole unit; second 360 s header / 400 s body attempts succeed within 900 s, two identical generation bodies and one PDF upload. Unscaled 1.5–1.875 s retry backoff remains. Absolute expiry admits no retry.
S5: all three same-content slow fixtures still succeed. Changed existing assertions have reason comments. Added processing-poll, finalize-stall, rollback/counter, validation, disk-failure and journal cancel/final-checkpoint race checks.
Exact new user-facing lines (existing stage names and sanitized diagnostics retained):

- "The upload stopped moving. Your saved work is still here."
- "Gemini is taking longer to answer. You can try again."
- "The rest of the answer stopped arriving."

ROADMAP records the exact owner implementer order; schema-14 manifest/SHA256SUMS rebound without helper/schema edits. Only synthetic sources/keys and loopback HTTP; no live-provider, installed-app, release or merge claim. GEN-02 and later slices untouched.

| Changed file | SHA256 |
| --- | --- |
| `ROADMAP.md` | `050772d56de9e6f0cdcfdd3029327ae8cd826798635a6acf57aa145d1d19a02c` |
| `docs/evidence/mac-schema14-completion-2026-10-15/SHA256SUMS` | `34232f29ff7dc5d3cd53308df6e35dadf8545dca79a85898d4547c1b2e984453` |
| `docs/evidence/mac-schema14-completion-2026-10-15/source-manifest.json` | `041b008e636a2c01b5f222fb7e68a81f34a7cdc555f1f888e89ee6d17ce3e629` |
| `src-tauri/src/gemini.rs` | `6a4bbe3d74b8dd5cd14075817bce6ad0f58e9aff3a2c6a061e0da5fadd77bd93` |
| `src-tauri/src/gemini_batches.rs` | `4429b329b46df1bbcaff86e9505834a7057b64d4799f5891fbc826461a258e5f` |
| `src-tauri/src/gemini_budget.rs` | `251e9237ffde6bf119ae8aa246a7fd0eb73d639da8fe705395d0280def76c9b2` |
| `src-tauri/src/gemini_cancel.rs` | `dc6f33ee7cd98f20710d029c9b23606091535ebd4fa43eeeca5c339e6206bbd0` |
| `src-tauri/src/gemini_files.rs` | `9aac7bac242edd50cf8a54aecf85236e00dc9e0132092e63b1fa616cd3e71d5a` |
| `src-tauri/src/gemini_files_tests.rs` | `6df937807078fae8fbfa5945cdb812af02db88589f71644785a85dd79c32ce87` |
| `src-tauri/src/gemini_jobs_tests.rs` | `f1982e3eee0dfee8b0cd1c8c268764a0306160ef3b6f5095ff2faee7f3537cbc` |
| `src-tauri/src/gemini_rate_tests.rs` | `030e42aa982e6fd41b98794520b2ea15199880b4aa334639a872d090ae4aae2f` |
| `src-tauri/src/gemini_recovery_tests.rs` | `0fc71576d77967fae85ce7b1aeb09c36a0e4f959570c67c941e512d96313cf15` |
| `src-tauri/src/gemini_slowlink_tests.rs` | `03c09cc97b9ed253cc04743d68e5048c7521e566bd4129d1a2c5bddaeba71aa2` |
| `src-tauri/src/gemini_stage_tests.rs` | `87682eda5cfeed4457a3a16aa514be9c43a0570d1a83c7ba28104a1fca4903f2` |
| `src/services/gemini.ts` | `09a27b4a9780c31b3b65d5213986692b88743062a8028548922b7460ac57bf71` |
