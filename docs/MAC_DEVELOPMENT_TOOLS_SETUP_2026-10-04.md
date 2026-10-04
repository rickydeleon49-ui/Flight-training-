# Mac tool setup and step-by-step use — 4 October 2026

The owner requested installing the five recommended tools and going down the list. Installation is complete for the CLIs, and Context7 is connected to Claude. **WebdriverIO's app-side integration is a separate, still-pending implementation step**; global tool installation does not supply project dependencies or instrument the app. The active A2 verification files and earlier dirty primary checkout were preserved. [Observed setup/evidence](evidence/mac-development-tools-2026-10-04/README.md).

## 1. Playwright CLI — installed and browser-verified

Installed official `@playwright/cli@0.1.22` globally and installed its Claude skill at `~/.claude/skills/playwright-cli`. An isolated `about:blank` session successfully created/clicked a synthetic button, verified its resulting page title, then closed. The older Claude Playwright MCP entry timed out during its health check; it was not changed. Use the verified CLI for the following steps.

Terminal 1, start the browser preview from the agreed app checkout:

```sh
cd /Users/rickymac/code/Flight-training-pr70-integration
npm run dev
```

Use the actual local address printed by Vite. This project normally uses port 1420. Terminal 2, open that printed address in a temporary browser session (the following example assumes port 1420):

```sh
playwright-cli -s=hfd-preview open http://localhost:1420 --headed --browser chrome
playwright-cli -s=hfd-preview snapshot
```

You can click through the visible browser yourself, or ask Claude: "Use playwright-cli session hfd-preview to check the daily plan, lessons and study screens with synthetic data. Save screenshots and exact reproduction steps for any failures." Browser mode uses separate browser storage; PDF import is disabled. It is interface testing, not installed Mac verification.

When finished:

```sh
playwright-cli -s=hfd-preview close
```

Stop only the preview process you started with Control-C in Terminal 1. Do not use commands that close other agents' browser sessions.

[Official Playwright CLI instructions](https://github.com/microsoft/playwright-cli).

## 2. Context7 — connected to Claude

Already installed in Codex. Added Claude's user-scoped HTTP connection at `https://mcp.context7.com/mcp`; `claude mcp get context7` reports **Connected**. No API key or paid subscription was needed for this connection check. Anonymous access has limits; authentication can be added later through the provider's supported flow if needed.

Restart an already-running Claude session to load the connection. Ask: "Use Context7 to check the current documentation for the exact Tauri 2/React/Zod version involved before changing an API integration."

Verify configuration any time:

```sh
claude mcp get context7
```

[Official Context7 client setup](https://context7.com/docs/resources/all-clients). Use public library queries; don't submit private source, credentials or personal training records as documentation queries.

## 3. GitHub CLI — existing installation verified

`gh` version **2.102.0**, signed-in account **rickydeleon49-ui**. No new sign-in or reinstall was needed.

```sh
gh pr list --repo rickydeleon49-ui/Flight-training-
gh run list --repo rickydeleon49-ui/Flight-training- --limit 5
```

These read PR/build status. Release downloads and publication stay within the existing exact-installer workflow and owner scope. [GitHub CLI](https://cli.github.com/).

## 4. WebdriverIO/Tauri — tooling installed; app integration pending

Installed globally: `@wdio/cli@9.32.0`, `@wdio/tauri-service@1.4.0`. CLI version/help and service ESM import verified. The service's module imports successfully; **no native app session was executed**.

```sh
wdio --version
```

After Claude finishes the current A2 evidence task and Codex merges it, Claude should implement the repository integration on a fresh tooling branch. Follow [the official Tauri service](https://github.com/webdriverio/desktop-mobile/tree/main/packages/tauri-service) and [plugin setup](https://github.com/webdriverio/desktop-mobile/blob/main/packages/tauri-service/docs/plugin-setup.md):

1. Pin reviewed project-local development dependencies. Global installation alone does not make imports resolvable from repository configs.
2. Add the embedded WebDriver and optional advanced-API plugins through an explicit test feature/config. Keep test endpoints, permissions, front-end mocking imports and test-only configuration out of ordinary production builds.
3. Provide a separate test app identifier/data directory and enforce synthetic fixtures; confirm the default app/profile cannot be selected accidentally.
4. Add focused native UI tests for dialogs, material saving and navigation with meaningful assertions and retained receipts.
5. Before launching a native test build, use the dedicated standard account and establish isolation. Installed release verification must still use exact candidate bytes; instrumented tests do not certify a production installer.
6. Leave implementation uncommitted/unpushed for independent Codex review, following the agreed workflow. Do not interrupt the current A2 task or merge tooling changes into its dirty branch.

**Owner step:** System Settings → Users & Groups → Add User → Standard, for example "HFD Test". Keep its password yourself; complete first login and report only that the account is ready. This account remains a prerequisite for the planned native/installed workflow. Signing and artifact selection remain separate.

## 5. cargo-deny — installed; first scan recorded

Installed Homebrew's Apple Silicon **cargo-deny 0.20.2**. The following scan was actually run with the app lockfile fixed:

```sh
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH"
cargo deny --locked --manifest-path /Users/rickymac/code/Flight-training-pr70-integration/src-tauri/Cargo.toml --target aarch64-apple-darwin check advisories
```

**Result: exit 1, six unmaintained-dependency advisories, zero vulnerability-category diagnostics in this scan.** `ttf-parser` arrives through `lopdf`; five `unic-*` crates arrive through `urlpattern`/Tauri. IDs are RUSTSEC-2026-0192, RUSTSEC-2025-0081, RUSTSEC-2025-0075, RUSTSEC-2025-0080, RUSTSEC-2025-0100 and RUSTSEC-2025-0098. The retained receipt contains dependency paths and exact installed versions. This is not a claim that the whole app is vulnerability-free.

The checker is working. No dependency was upgraded and no advisory was suppressed. A follow-up dependency assessment should distinguish maintenance notices from exploitable defects, examine upstream fixes, and document any narrowly justified policy decision. Project license/source/banned-crate policy is not configured yet; the advisory scan used defaults. Do not generate a blanket allow/ignore policy just to get a green result.

[Official cargo-deny](https://github.com/EmbarkStudios/cargo-deny).

## Current next step

Finish the active A2 evidence correction and review first. Then use the installed browser tools for interface checks, provision the standard account, and assign the scoped WebdriverIO integration. The owner wants a testable Mac build next; this tool setup creates no installer, release tag, signing change or release approval.
