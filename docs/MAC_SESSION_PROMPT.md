# Prompt for the agent on the physical Mac

Audit and test Her Flight Deck on this Mac, using GitHub as the shared source of truth. You do not have access to the Windows computer's H: drive, attachments or local logs; do not depend on them.

Exact private repository: https://github.com/rickydeleon49-ui/Flight-training-.

First read `docs/PROJECT_HANDOFF.md` and the latest Mac report/PR it links. Source evaluation has already been reported in draft PR #44; inspect that evidence and continue the missing installed-app checks rather than automatically rerunning unchanged passing suites. The shared open-source research and next-task prompt are in `docs/OPEN_SOURCE_MAC_HANDOFF.md`; do not adopt a library before its foundation/testing gates.

Read `STATUS.md`, `docs/MAC_GITHUB_HANDOFF_2026-10-02.md`, `docs/MAC_PARITY_CHECKLIST.md`, `docs/FULL_REPOSITORY_AUDIT_2026-09-29.md`, `docs/RELEASE_REVIEW_PROCESS.md` and `docs/A2_SECOND_REVIEW_2026-10-02.md`. Follow the build/test and artifact distinction in the handoff. Do not claim a pending Windows-local fix is present in main.

Start by locating or cloning the repository, confirming a clean checkout and the exact current main SHA. Record Mac chip, RAM, architecture, macOS version, Node/npm/Rust versions and Apple's developer-tool path. Use Node 22 to match normal CI. Check prerequisites before installing anything. Keep authentication and all API keys out of chat, logs and committed files.

Use a dedicated standard test user with synthetic data. App storage is `~/Library/Application Support/com.herflightdeck.app`; environment-variable redirection does not isolate it. Preserve any existing application/data and use another test user if needed. Do not delete a real profile or existing installer to make room for tests.

Run the full local matrix once, sequentially: npm ci; npm test; npm run build; cargo fmt --manifest-path src-tauri/Cargo.toml --check; cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings; cargo test --locked --manifest-path src-tauri/Cargo.toml; npm run test:cargo-lock; git diff --check. Record exact command results/logs. Stop at real failures and diagnose with focused checks rather than another full matrix or CI push.

Generate the three synthetic PDFs using the repository's `scripts/generate-pdf-fixtures.mjs` in a new temporary directory. Check their hashes/page counts against the tracker; keep large binaries out of Git. Do not need any fixture from Windows.

If the matrix passes, build a local source evaluation DMG with `npm run tauri build -- --target aarch64-apple-darwin --bundles dmg`. Record tested source SHA, exact artifact path, size and SHA-256; inspect arm64, `com.herflightdeck.app`, minimum macOS 12.0 and signing status. This artifact is distinct from the frozen private v0.5.3 draft, even if it displays the same version. Do not replace draft assets or checksums, change tags, bump versions, publish releases or trigger a release workflow.

Install and launch normally in the isolated test context. Record any Gatekeeper/signing refusal and stop dependent installed-app tests. Do not disable protections or clear quarantine. A development run can help diagnosis but must not be reported as an installed-DMG pass.

Perform and record actual smoke tests for first launch, dialogs, PDF import and app-owned survival after source relocation, Open/default viewer, document Reveal, Settings Open folder, material/tag editing, automatic long/image-heavy splitting, manual split/range validation, concurrent save/split/backup behavior, complete backup to Downloads, integrity/secret-entry inspection, restore with conserved rows/file hashes, corrupted-archive refusal, offline saved study content and upgrade over a synthetic existing dataset. Run live Gemini only when configured and explicitly enabled for the selected synthetic PDF; otherwise mark it unverified. Record timings, memory and responsiveness without inventing a speedup.

Pay special attention to known A3 early macOS 12/WKWebView compatibility. A current Mac OS cannot prove minimum-version support. Record filesystem-case and symlink behavior; unavailable OS/volume tests stay unverified. Do not create or format a case-sensitive disk without a separate explicit user request.

Save a sanitized report based on `docs/templates/MAC_SMOKE_RESULTS_TEMPLATE.md` under `docs/`, with pass/fail/blocked/unverified outcomes, exact evidence, reproducible bugs, and an implementation recommendation for each failure. Update the tracker only for outcomes you personally observed; preserve historical frozen-artifact identities and existing holds.

Keep the task bounded to Mac evidence and identified Mac repairs. Do not start iOS or unrelated features, adopt libraries, alter shipped migrations, weaken permissions or change backup/secret guarantees. For fixes, coordinate a scoped branch from updated main, run focused tests for each change and the final matrix once after all corrections, and leave changes uncommitted for Codex's independent review. Do not push merely to discover CI failures, merge your own unreviewed work or mark the app release-ready without actual required evidence.
