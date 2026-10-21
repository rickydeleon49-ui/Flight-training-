# Agent workflow

`CLAUDE.md` holds the product, stack and data-safety rules. They apply to every agent.

## Roles (owner, 19–21 October 2026)

- **Implementers, in order:** Codex first; then Gemini (Gemini CLI, model
  `gemini-3.8-flash`); then MiniMax M3.1 Flash only while free on Ollama,
  until 2026-10-22 16:59 PDT; then Qwen Flash as the last backup.
- When Codex's usage resets, new rounds go back to Codex. An in-flight round by
  another implementer is allowed to finish.
- **Claude** assigns precise rounds, reviews, independently tests and merges.
- The owner wants **full reviews** every round.
- **Rule:** an implementer never approves or merges its own round.

### When Claude is out of usage

- Codex takes over Claude's reviewer, tester and merger role, following the
  **Reviewer and merger recipe** exactly: full independent gates, mutation
  checks, wording review, exact-head CI, `gh pr merge --merge --match-head-commit`,
  and verification that the work is on main.
- Reviews go in the round folder's `claude-review*/REVIEW.md`, or
  `codex-review*/REVIEW.md` when Codex reviews; the reviewer updates
  `CURRENT_QWEN_REVIEW_LOOP.json`.
- While Codex reviews, Gemini (`gemini-3.8-flash`), then MiniMax M3.1 Flash
  within its free window above, then Qwen Flash, implement.
  **No implementer reviews or merges its own round.**
- Claude takes the role back when its usage returns, starting by reading the
  loop file and the latest round folder.

## Where the state lives

- `ROADMAP.md`: the top entry holds the latest owner decisions and the current order.
- `docs/PROJECT_HANDOFF.md`: current ownership.
- Outside the repo, on this Mac:
  - `/Users/rickymac/code/.gen-rel-loop/offline/CURRENT_QWEN_REVIEW_LOOP.json`:
    the live round state;
  - per-round folders under `/Users/rickymac/code/.gen-rel-loop/offline/<round>/`,
    holding `prompt.md`, results and `claude-review*/REVIEW.md`;
  - `/Users/rickymac/code/.gen-rel-loop/offline/CLAUDE_REVIEW_CHECKLIST.md`:
    the review recipe.
- **Plans:** `docs/OFFLINE_GEN_PLAN_2026-10-20.md` covers the current OFFLINE-GEN
  tranche (owner defaults D1–D8 approved).

## Implementer rules

- Work only in the named worktree. **Never** commit, push, open a PR, reset,
  stash, clean, or install packages; the reviewer commits and pushes.
- Use Node 22: `PATH=/opt/homebrew/opt/node@22/bin:$PATH`.
  The default Node 26 gives false failures.
- **Cargo:**
  `env SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk CARGO_TARGET_DIR=<worktree>/src-tauri/target CARGO_NET_OFFLINE=true cargo …`.
- Run every gate command through the receipt runner:
  `python3 /Users/rickymac/code/.gen-rel-loop/offline/qwen-03b-r4-20261019/receipt.py <log> <cmd...>`.
  Use default test settings: no `--testTimeout` override and no custom gate
  scripts. Use `--configLoader runner` only when a sandbox blocks Vite's temp write.
- **Test waits:** in native tests, use the shared `src-tauri/src/test_wait.rs`
  helper (30 s bound), never fixed short loops. Frontend timeouts are global
  (`vite.config.ts` plus `src/testing/vitestSetup.ts`).
- **No:** a real API key, a real profile, a real PDF, or any network beyond
  loopback test servers.
- Migrations only add. There are no new dependencies without the owner's
  approval. The owner approved `http-body` and `bytes` as direct dependencies
  on 2026-10-20, at their already-locked versions.

## Reviewer and merger recipe (also for a takeover reviewer)

1. **Rerun the gate independently, outside any sandbox.** Run Cargo commands
   from `src-tauri/`, using the Cargo environment above, and use Node 22 and
   the receipt runner for the gates:
   - `cargo test --locked --no-fail-fast` in default parallel mode, twice;
   - `npm test` at default settings, twice;
   - `cargo clippy --locked --all-targets -- -D warnings`;
   - `cargo fmt --check`;
   - `npm run test:cargo-lock`;
   - `npm run typecheck`;
   - `npm run build`;
   - `node --test scripts/mac-schema14-profile-snapshot.test.mjs` (26/26);
   - `git diff --check`.
2. Mutation-test every new guard on a scratch copy (never the worktree).
   The relevant test must fail.
3. **Review:** user-facing wording against `PRODUCT_SPEC.md`; that the scope
   is honoured; and that nothing secret is stored or shown. For UI rounds,
   also do a browser-mode walkthrough.
4. **On GREEN:**
   - commit, excluding `node_modules` and `src-tauri/target*`;
   - push and open a PR;
   - wait for CI on the **exact** head;
   - `gh pr merge <n> --merge --match-head-commit <sha>`;
   - then verify with `git merge-base --is-ancestor <sha> origin/main`.
5. **On a CI failure:** read the failing log and find the root cause before
   rerunning. Treat a possible lost cancellation or data issue as P1 until
   proven test-only.

## Gotchas learned on 2026-10-20

- **MiniMax launch:** `ollama launch claude --model minimax-m3.1-flash:cloud -- -p … --permission-mode acceptEdits --disallowedTools 'Bash(git:*)' 'Bash(gh:*)' 'Bash(rm:*)' 'Bash(npm install:*)' 'Bash(npm ci:*)' 'Bash(npm update:*)' 'Bash(npm add:*)' 'Bash(npx:*)' 'Bash(pnpm:*)' 'Bash(yarn:*)' 'Bash(bun:*)' 'Bash(brew:*)' 'Bash(pip:*)' 'Bash(pip3:*)' 'Bash(uv:*)' 'Bash(cargo install:*)' 'Bash(cargo add:*)' 'Bash(curl:*)' 'Bash(wget:*)' 'Bash(ssh:*)' 'Bash(scp:*)' 'Bash(sftp:*)' 'Bash(rsync:*)' 'Bash(nc:*)' 'Bash(netcat:*)' 'WebFetch' 'WebSearch' 'Agent'`. Keep these explicit denies: inherited Mac Claude settings allow `gh pr close`.
- `cargo test` takes **one** name filter.
- The Codex sandbox can't write `.git`, and blocks `pgrep` and some sockets;
  the reviewer reruns those tests outside it.
- **Gemini CLI:**
  - don't use `-s` (sandbox mode needs a `GEMINI_API_KEY` env var and exits
    with code 41);
  - launch with `--policy /Users/rickymac/code/.gen-rel-loop/offline/gemini-implementer-policy.toml`
    instead of `--allowed-tools`. The policy allows build, test and inspect
    commands; it denies git writes, installs, destructive commands and network;
  - headless Gemini always denies `>` redirection; use the receipt runner and
    its `write_file` tool;
  - use `--approval-mode auto_edit` and
    `--include-directories /Users/rickymac/code/.gen-rel-loop/offline`;
  - Gemini itself must run on the default Node. Export
    `PATH=/opt/homebrew/opt/node@22/bin:$PATH` for its child commands, then invoke
    `/opt/homebrew/bin/node /opt/homebrew/bin/gemini …`. Running Gemini under
    Node 22 hangs;
  - a `PATH=…` command prefix is denied.
- macOS has no `timeout` command.
- An `Ok(Err(CANCELLED))` from a cancelled worker means cancellation was
  honoured; it isn't a lost cancel.
