# Claude Mac continuation — A6 truthful Gemini retry wording

Continue Her Flight Deck in `/Users/rickymac/code/Flight-training-` on this Mac. Claude owns implementation, focused regressions, the complete local gate and report. Codex owns focused independent review and reviewed Git/CI/merge. Keep this a small native correction; do the implementation and evidence work yourself before handing it back.

**Begin only after the accepted A4 publication merges with passing required CI.** Fetch GitHub, confirm main contains `docs/MAC_A4_OFFLINE_STUDY_ACCEPTANCE_2026-10-02.md`, and inspect branch, clean/dirty state, ongoing PRs and task ownership. With a clean checkout, switch to main and update by fast-forward only. Create `codex/mac-gemini-retry-wording-a6` from that exact main; inspect any existing branch instead of overwriting it. Never reset/stash another task's changes. Record the base SHA. If publication is pending, report the prerequisite and stop before editing.

Read STATUS, ROADMAP, `docs/PROJECT_HANDOFF.md`, the A3/A4 acceptance documents and A6 in `docs/FULL_REPOSITORY_AUDIT_2026-09-29.md`. A3/A4 are source-accepted; installed Mac, VoiceOver and offline checks remain open. A2 material-save/SQL-driver/attachment work remains with its Windows owner until reviewed source is shared. Preserve those boundaries.

**Implement A6 only:** Gemini's final busy message currently describes elapsed time using `total_wait_seconds()`, which sums nominal backoff delays and omits request time, jitter and the fallback request. Inspect `generate_with_retries`, `waiting_message`, `busy_message`, `rate_limit_message`, `describe_refusal` and every caller in `src-tauri/src/gemini.rs` before editing.

Prefer removing the elapsed-time claim from final failure text. Keep per-pause progress truthful about the upcoming pause, not total operation duration. Remove the obsolete duration helper if unused. If you instead retain an elapsed-time claim, measure the complete operation and cover delayed responses, jitter and fallback time through an injected clock/HTTP seam; do not use live requests or long sleeps.

Inspect the same message helpers' connection-verification callers: a one-shot refusal must not claim that four generation attempts or a fallback request occurred. Use generic wording where retry history is unavailable, or pass the known context narrowly. Keep exhausted-generation wording consistent with what actually happened. This is a wording/context correction, not a change to retry policy or provider behavior.

Preserve bounded attempt counts, backoff/jitter, timeouts, fallback selection, cancellation/progress behavior, API-key handling and distinct guidance for 429/quota, invalid keys, permissions and retired models. Preserve explicit submission and the UI operation lock. Do not change models, request payloads, dependencies, migrations, SQLite, backups or A2 production boundaries.

Add meaningful focused failing regressions for the incorrect elapsed-time claim and any verified one-shot retry-history claim; keep existing error classification and bounded-backoff tests. For the removal approach, test the message contract without asserting every exact word or introducing a network test framework. Reuse existing seams; no paid/live Gemini calls. Run the relevant Rust module tests during development.

After the final correction, run **one sequential complete local gate** with scoped Node 22/Rust PATH and `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`: `npm ci`, `npm test`, `npm run build`, `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo test --locked --manifest-path src-tauri/Cargo.toml`, `npm run test:cargo-lock`, and `git diff --check`. Do not overlap matrices or rebuild installers/benchmarks for unchanged scope. This project uses SQLite, not PostgreSQL.

Write `docs/MAC_A6_RETRY_WORDING_IMPLEMENTATION_2026-10-02.md` with issue-to-fix mapping, representative old/new messages and their call contexts, exact branch/base, source hashes, test names, meaningful negative controls, commands/counts and limits. Add sanitized receipts under `docs/evidence/mac-a6-retry-wording-2026-10-02/`; update STATUS, handoff and Mac tracker as local/pending independent review. Record a brief remaining-foundation checkpoint and recommend the next scoped task without starting it.

Preserve macOS 12 and Windows support, backup v3 and v1/v2 restore, all release holds and the frozen v0.5.3 candidate. Do not launch the owner's installed profile, install a DMG, alter signing/accounts or bypass Gatekeeper. Installed readiness needs the existing dedicated-account and signing prerequisites.

Keep the agreed open-source plan conditional: MiniSearch remains unjustified by the accepted baseline; virtualization needs expanded-rendering/installed evidence; Zod/react-markdown require the approved structured-import contract; EmbedPDF remains a later viewer/license/WebKit gate. Adopt no library here. Do not begin M2 migrations/scheduler, import, embedded-reader or iOS work before their scope/user-check-in gates.

Leave all changes **uncommitted and unpushed**, report the result, then stop for Codex review.
