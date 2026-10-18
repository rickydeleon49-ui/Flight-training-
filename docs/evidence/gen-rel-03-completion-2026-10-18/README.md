# GEN-REL-03 completion evidence

Base: `17c80ee` (PR #214). Claude's interrupted work was completed by Codex on `codex/gen-rel-03-completion`. **Pending independent review; no merge or release acceptance.** Synthetic data and loopback HTTP only; no app launch, real profile, key or provider request.

Environment: Node 22.23.3, rustup stable Rust 1.99.0, SDK `/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`.

## Final gate

| Receipt in `gate/` | Result | Exit |
| --- | --- | --- |
| `01-typecheck` | clean | 0 |
| `02-frontend` | 3,676 passed / 6 skipped; no unhandled errors | 0 |
| `03-build` | frontend bundle built | 0 |
| `04-native` | 642 passed / 6 ignored | 0 |
| `05-clippy` | strict `-D warnings` | 0 |
| `06-fmt` | clean | 0 |
| `07-lock` | Cargo lock consistency | 0 |
| `08-schema-helper` | 26 passed | 0 |
| `09-protected-and-manifests` | tracker history preserved; protected paths unchanged; 20 current helper bindings / 21 checksum members; whitespace hygiene | 0 |

`results.json` records commands/start times for the seven build/test/lint steps. Each command has a raw output and `.exit`. The typecheck, frontend, build and both full native outputs are losslessly compressed as `.txt.gz` because their original trailing spaces/blank lines are intentional command output; use `gzip -dc` to read them. No receipt content was trimmed. The helper and preservation check have their own raw receipts/exits. Raw compiler/test output is not edited to make it look successful. The initial compilation/focused shell wrappers printed a log tail after cargo, so their numeric cargo exits were not separately captured; the accompanying outcome JSON records this limitation instead of inventing raw exits. Final gate commands do capture their actual exits.

## Earlier outcomes remain separate

- `inherited/compile-first.txt`: original partial implementation could not compile its tests (16 errors). `inherited/source-hashes.txt` binds the four starting files. The original tracked-file diff is losslessly retained as `inherited/submitted.patch.gz`, and the untracked file as `inherited/gemini_budget.rs.txt`; the original copies also remain outside the repo. The four starting hashes bind the reconstructed inputs.
- `diagnostics/focused-first-failed.txt`: 141 passed / 4 failed. Three expected obsolete message text (the old retirement assertion twice, and a guide-specific phrase); the new Retry-After assertion expected a different phrase. The request-count/cache assertions remain; changed wording expectations are documented in the report.
- `gate/attempt1-results.json` and `*-before-signature-correction.*`: successful first full native run plus failed strict Clippy (eight-argument readiness function), followed by fmt. The signature was refactored without adding a lint allowance. Native tests, Clippy and fmt were rerun on the corrected source. Frontend tests/typecheck/build inputs remained byte-identical, so their valid receipts were reused.
- `diagnostics/inventory-refresh-first.txt`: first inventory maintenance check identified three current tracker hashes that still needed refresh; final check validates all bindings and members.

## Verification

`source-hashes.json` binds changed native source/tests, trackers, report/reviewer prompt and relevant unchanged inputs. `SHA256SUMS` inventories this evidence directory except itself (including the source manifest). Verify both before relying on the report. The schema-14 helper's historical receipts are unchanged; only its current tracker bindings and dependent current checksum entries were refreshed.

Twenty-nine new permanent tests: 22 recovery tests in `src-tauri/src/gemini_recovery_tests.rs`, five budget tests in `gemini_budget.rs`, two expiry tests in `gemini_files_tests.rs`. Status, output and delay tests contain additional explicit matrix members. The full native gate includes all old concurrency, stale-context, upload ownership and job/restart tests; the full frontend gate includes checkpoint/save-only recovery.

The active network budget is per deliberate job. No automatic inference resume exists: restart reads interrupted/ready jobs without any provider request; checkpoint Save again is local-only. A deliberate new generation has a new job identity. The report records this interpretation rather than inventing a persisted inference-resume protocol.

Live-provider latency/quality, real weak internet, installed Mac UI and release behavior remain **UNVERIFIED**. Native test compilation and a frontend bundle do not establish those outcomes.
