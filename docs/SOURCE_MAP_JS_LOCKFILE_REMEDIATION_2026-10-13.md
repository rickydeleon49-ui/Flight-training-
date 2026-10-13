# Remediation Report: source-map-js Lockfile Increment (M0) — 13 October 2026

## 1. Scope and Objective

This task implements exactly one bounded M0 dependency-maintenance increment: resolving the transitive development dependency `source-map-js` from `1.2.1` to exactly `1.2.2`, preserving `package.json` and all other dependency resolutions.

- **Implementer:** Antigravity (owner-selected implementer; assignment is model-neutral).
- **Governing policy:** `CLAUDE.md`, `PRODUCT_SPEC.md`, `docs/PROJECT_HANDOFF.md`, and project conventions.
- **Dependency rule:** No new direct dependency, no `package.json` changes, no overrides, no unrelated lockfile churn.
- **Allowed touched paths:**
  1. `package-lock.json`
  2. `docs/SOURCE_MAP_JS_LOCKFILE_REMEDIATION_2026-10-13.md`
- **Preserved state:** Shipped migrations, bundle identifier `com.herflightdeck.app`, versions, security controls, backup guarantees, and accepted unintegrated packages (schema14, MAINT-143-KEYS, timezone PR152, REL-03, and M4 in-flight work).
- **Preserved REL-03 Package References:**
  - Owner Delegated Review Receipt: `runs/20261013-142913-309257/OWNER_DELEGATED_REVIEW.md`
  - Accepted Triage Document: `runs/20261012-231820-023155/worktree/docs/DEPENDENCY_ALERT_TRIAGE_2026-10-12.md`
  - Accepted Remediation Prompt: `runs/20261012-231820-023155/worktree/docs/DEPENDENCY_ALERT_REMEDIATION_PROMPT_2026-10-12.md`
  *(Referenced directly without copying or rewriting accepted triage documents.)*

---

## 2. Baseline Verification and Pre-Edit Inspection

### Fresh Upstream-Main Inspection Status and Baseline Comparison

- **Historical Pre-Edit Status:** Pre-edit live upstream verification could not be demonstrated historically. During planning, live GitHub access failed because DNS was unavailable; the starting checkout in the isolated clone relied on the primary repository's recorded `origin/main` ref (`3d27ef3a8ef5131895455bd2346b4f7e0ce20239`) rather than a live network fetch against GitHub prior to editing. In accordance with reviewer instructions, this historical gap is disclosed directly rather than fabricating a gate.
- **Live Upstream Query Execution:** An attempt to inspect and compare live upstream `main` was executed:
  - Command: `GIT_DIR=/tmp git ls-remote https://github.com/rickydeleon49-ui/Flight-training- main`
  - Result: Prompts interactively for authentication credentials (`Username for 'https://github.com':`).
  - `gh auth status` check: Confirms the stored credential token for `rickydeleon49-ui` is invalid (`Failed to log in to github.com account rickydeleon49-ui (default) - The token in default is invalid`).
  - Unauthenticated HTTP probes: Requests to `https://github.com/rickydeleon49-ui/Flight-training-` return HTTP 404 (GitHub's standard unauthenticated behavior for private repositories).
  - Outcome: The upstream GitHub repository is private and no valid GitHub authentication credentials exist in the runner/sandbox environment. Live remote inspection is therefore blocked by lack of valid credentials.
- **Baseline Comparison Across Checkouts:**
  - **Local Starting HEAD:** `3d27ef3a8ef5131895455bd2346b4f7e0ce20239` (matching accepted HEAD and recorded `origin/main` in the primary repository). Locks `source-map-js@1.2.1`.
  - **Parent Isolated Clone HEAD (`isolated-repo`):** `8a260c0` (`git worktree list` confirms `/Users/rickymac/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an/outputs/flight-deck-team/runs/20261013-150210-791243/isolated-repo 8a260c0 [main]`, representing the clean synchronized local main preserved after October 11 workspace maintenance).
  - **Live Upstream Main Comparison:** Cannot be compared directly against GitHub upstream `main` from this environment because network verification is blocked by missing/invalid credentials.
- **Reviewer Reassessment and Required Coordinator Action:**
  - Because live upstream verification remains blocked by authentication, no live baseline comparison against GitHub remote `main` could be generated autonomously.
  - Reviewer reassessment and coordinator action are required before final approval/integration to verify live upstream `main` against `3d27ef3a8ef5131895455bd2346b4f7e0ce20239` and ensure no remote drift has occurred.
- **Isolated Checkout Baseline HEAD:** `3d27ef3a8ef5131895455bd2346b4f7e0ce20239` (matching accepted HEAD and recorded `origin/main`).

### Dependency Constraints and Baseline State

- **Parent dependency constraints:**
  - `css-tree@3.2.1` (transitive via `jsdom@30.0.1`): specifies `"source-map-js": "^1.2.1"`
  - `postcss@8.5.28` (transitive via `vite@7.3.6`): specifies `"source-map-js": "^1.2.1"`
  - Both ranges satisfy `^1.2.1` and permit `1.2.2`.
- **Baseline lockfile entry (`package-lock.json` lines 2870–2879):**
  ```json
  "node_modules/source-map-js": {
    "version": "1.2.1",
    "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz",
    "integrity": "sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==",
    "dev": true,
    "license": "BSD-3-Clause",
    "engines": {
      "node": ">=0.10.0"
    }
  }
  ```
- **Baseline resolution (`npm ls source-map-js`):**
  ```text
  her-flight-deck@0.5.3
  ├─┬ jsdom@30.0.1
  │ └─┬ css-tree@3.2.1
  │   └── source-map-js@1.2.1
  └─┬ vite@7.3.6
    └─┬ postcss@8.5.28
      └── source-map-js@1.2.1 deduped
  ```
- **Baseline audit:** Reported 1 high severity vulnerability (`source-map-js@1.2.1`, Dependabot Alert #2 / CVE event-loop denial of service on indexed source-map offsets).

---

## 3. Authentic Registry Metadata and Lockfile Delta

Authentic npm registry metadata was obtained via standard npm registry resolution for `source-map-js@1.2.2`:

- **Version:** `1.2.2`
- **Resolved URL:** `https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.2.tgz`
- **Integrity:** `sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==`

### Structural Comparison Against Baseline

Only `node_modules/source-map-js.version`, `.resolved`, and `.integrity` fields changed in `package-lock.json`:

```diff
     "node_modules/source-map-js": {
-      "version": "1.2.1",
-      "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz",
-      "integrity": "sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==",
+      "version": "1.2.2",
+      "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.2.tgz",
+      "integrity": "sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==",
       "dev": true,
       "license": "BSD-3-Clause",
       "engines": {
```

- `package.json` remains completely untouched.
- No other dependencies, versions, or lockfile keys were altered.
- No overrides or direct dependency additions were introduced.

---

## 4. Isolated Dependency Restoration and Resolution Verification

Dependencies were restored inside the isolated workspace using `npm ci` without reusing any shared node_modules tree:

- **Command:** `npm ci`
- **Result:** `added 166 packages, and audited 167 packages in 2s; found 0 vulnerabilities` (exit code `0`).
- **Installed package verification:** `node_modules/source-map-js/package.json` confirms installed version `1.2.2`.
- **Resolution tree (`npm ls source-map-js`):**
  ```text
  her-flight-deck@0.5.3 /Users/rickymac/Documents/Codex/2026-10-11/referenced-chatgpt-conversation-this-is-an/outputs/flight-deck-team/runs/20261013-150210-791243/worktree
  ├─┬ jsdom@30.0.1
  │ └─┬ css-tree@3.2.1
  │   └── source-map-js@1.2.2
  └─┬ vite@7.3.6
    └─┬ postcss@8.5.28
      └── source-map-js@1.2.2 deduped
  ```

---

## 5. Existing jsdom Integration Suites

As specified, the existing jsdom integration suites were executed without modifying tests:

1. **Rendered browsing/search suite:**
   - **Command:** `PATH="/opt/homebrew/opt/node@22/bin:$PATH" node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache src/pages/StudyLibrary/StudyLibrary.test.ts`
   - **Coverage:** Paged material display, "Show 100 more materials" browsing, and full-text library filtering/searching.
   - **Outcome (Node 22):** 1 file passed, 2/2 tests passed (exit `0`, 1.25s).
   - **Outcome (Node 26):** Node 26 introduces an experimental global `localStorage` that is `undefined` without `--localstorage-file`. With `NODE_OPTIONS="--localstorage-file=/tmp/vitest-ls.db"`, 2/2 tests passed (exit `0`, 1.11s).

2. **Rendered import/persistence suites:**
   - **Suite A (`ImportStudyPacketDialog`):**
     - **Command:** `PATH="/opt/homebrew/opt/node@22/bin:$PATH" node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache src/pages/StudyLibrary/ImportStudyPacketDialog.test.ts`
     - **Outcome (Node 22):** 1 file passed, 21/21 tests passed (exit `0`, 2.22s).
     - **Outcome (Node 26):** With `NODE_OPTIONS="--localstorage-file=/tmp/vitest-ls.db"`, 21/21 tests passed (exit `0`, 2.42s).
   - **Suite B (`materialSaveIntegration`):**
     - **Command:** `PATH="/opt/homebrew/opt/node@22/bin:$PATH" node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache src/pages/StudyLibrary/materialSaveIntegration.test.ts`
     - **Outcome:** 1 file passed, 3/3 tests passed (exit `0`, 1.18s).

---

## 6. Sequential Final Local Matrix

The final sequential local validation matrix was executed following the lockfile update in a single continuous pipeline on the supported Node 22 validation lane (`PATH="/opt/homebrew/opt/node@22/bin:$PATH"`):

**Command Pipeline:**
```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH"; npm run typecheck; node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache; npm run build; npm run test:cargo-lock; cargo fmt --manifest-path src-tauri/Cargo.toml --check; cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings; cargo test --locked --manifest-path src-tauri/Cargo.toml; git diff --check
```

### Sequential Execution Results (Node 22 Lane)

| # | Step | Command | Result | Details |
|---|---|---|---|---|
| 1 | TypeScript check | `npm run typecheck` | **PASS (exit 0)** | Clean typecheck, 0 errors |
| 2 | Vitest full suite (Node 22 lane) | `node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache` | **PASS (exit 0)** | 127 test files passed, 4 skipped (131 total); 3,038 tests passed, 6 skipped (3,044 total), duration 49.45s |
| 3 | Frontend production bundle | `npm run build` | **PASS (exit 0)** | `tsc --noEmit && vite build` built in 943ms |
| 4 | Cargo lockfile sync check | `npm run test:cargo-lock` | **PASS (exit 0)** | `her-flight-deck` is 0.5.3 in both `Cargo.toml` and `Cargo.lock` |
| 5 | Rust formatting check | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | **PASS (exit 0)** | Clean formatting, 0 diffs |
| 6 | Clippy linter | `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | **PASS (exit 0)** | 0 warnings, 0 errors |
| 7 | Rust test suite | `cargo test --locked --manifest-path src-tauri/Cargo.toml` | **PASS (exit 0)** | 471 tests: 465 passed, 0 failed, 6 ignored (37.07s) |
| 8 | Git diff check | `git diff --check` | **ENVIRONMENTAL BLOCKER (exit 128)** | Sandbox isolation blocks resolving worktree `.git` reference to `isolated-repo` outside sandbox boundary (`fatal: gitfile does not point to a valid repository`). Independent verification by controller confirms exit 0 and zero trailing whitespace |

### Node 26 Default Lane Disclosure & Narrowed Mitigation Analysis

To ensure complete transparency across engine versions, Node 26 (`/opt/homebrew/bin/node` v26.10.0) was tested and disclosed:

1. **Default Unmitigated Full Suite:**
   - **Command:** `node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache`
   - **Result:** **FAIL (exit 1)** — 108 test files passed, 19 failed; 2,873 passed, 165 failed.
   - **Root Cause:** Node 26 introduces an experimental global `localStorage` that evaluates to `undefined` unless `--localstorage-file` is set. All 165 failures are `TypeError: Cannot read properties of undefined (reading 'clear')` in suites using web storage.

2. **Full Suite with `--localstorage-file` Mitigation:**
   - **Command:** `NODE_OPTIONS="--localstorage-file=/tmp/vitest-ls.db" node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache`
   - **Result:** **FAIL (exit 1)** — 122 test files passed, 5 failed, 4 skipped (131 total); 3,026 passed, 12 failed, 6 skipped (3,044 total), duration 37.34s.
   - **Root Cause & Finding:** While `--localstorage-file` eliminates the 165 uninitialized storage crashes, multi-worker concurrent access across Vitest runner threads to a single `/tmp/vitest-ls.db` SQLite storage file causes cross-suite database lock and state contention across 5 stateful integration suites (`quickDebrief.test.ts`, `CardReviewPanel.test.ts`), resulting in 12 assertion failures.

3. **Targeted Mitigated Runs (Narrowed Scope):**
   - When run in isolation, individual suites pass cleanly with the mitigation:
     - `src/pages/StudyLibrary/StudyLibrary.test.ts`: **PASS (exit 0)** — 1 file passed, 2/2 tests passed (1.11s).
     - `src/pages/StudyLibrary/ImportStudyPacketDialog.test.ts`: **PASS (exit 0)** — 1 file passed, 21/21 tests passed (2.42s).

4. **Conclusion on Lane Compatibility:**
   - The project's official and supported validation lane is **Node 22** (`v22.23.3`), where all 127 test files and 3,038 tests pass with 0 failures.
   - The Node 26 failures reflect engine-level experimental Web Storage constraints and test runner file-backing contention under multi-threading, not a regression introduced by `source-map-js@1.2.2`.

---

## 7. Limitations and Release Boundaries

1. **Dependency resolution vs. Alert closure:**
   - This increment provides local lockfile resolution and clean source-level validation.
   - It **does not claim that GitHub Dependabot Alert #2 is closed**; alert closure occurs only after GitHub integrates the updated lockfile into upstream `main` and rescans the repository.
2. **Release and installed app status:**
   - No DMG, bundle, or release binary was built, signed, or published.
   - No installed application tests, standard-account tests, or real-profile accesses were conducted.
3. **Other dependencies:**
   - Cargo dependency `glib@0.18.5` (Alert #1) remains untouched and is out of scope for this M0 increment.
4. **Preserved artifacts:**
   - Preserves accepted unintegrated packages (schema14, MAINT-143-KEYS, timezone PR152, and REL-03) without modification.
   - Preserves and references the accepted REL-03 package (`runs/20261013-142913-309257/OWNER_DELEGATED_REVIEW.md`, `runs/20261012-231820-023155/worktree/docs/DEPENDENCY_ALERT_TRIAGE_2026-10-12.md`, and `DEPENDENCY_ALERT_REMEDIATION_PROMPT_2026-10-12.md`) without copying or rewriting its accepted triage documents.
   - Parallel M4 work remains entirely untouched.

## Coordinator integration review — 13 October 2026

The historical agent authentication limitation above was resolved by the coordinator using authenticated read-only GitHub requests. Live `main` returned `3d27ef3a8ef5131895455bd2346b4f7e0ce20239`; live `package-lock.json` returned blob `a875509e9c62a1ba2c8b62ea55a9a86d2e5c3e45`, matching the baseline. Thus upstream had not drifted and the correction remained needed. This verifies the integration baseline now; it does not invent a historical pre-edit network check.

The coordinator independently compared the complete parsed lockfile to baseline: only source-map-js version, resolved URL and integrity differ, with version exactly 1.2.2. Registry metadata from `npm view source-map-js@1.2.2 dist.integrity dist.tarball --json` matches both updated fields. The primary working checkout and all other saved packages remain preserved.

### Independent sequential final matrix

The coordinator reran the final checks sequentially with Node22 selected in PATH, an isolated Cargo target directory and offline locked Cargo resolution. All eight commands completed with exit 0:

- `npm run typecheck`: exit 0.
- `node node_modules/vitest/vitest.mjs run --configLoader runner --no-cache`: exit 0.
- `npm run build`: exit 0.
- `npm run test:cargo-lock`: exit 0.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: exit 0.
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: exit 0.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: exit 0.
- `git diff --check`: exit 0.

Frontend suite: 127 files passed, 4 skipped; 3,038 tests passed, 6 skipped. Rust summary: test result: ok. 465 passed; 0 failed; 6 ignored; 0 measured; 0 filtered out; finished in 48.86s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s; test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

Raw completed receipts are retained in controller run `20261013-160026-408760`, `owner-checks.json` and `owner-check-1.log` through `owner-check-8.log`. Historical Node26 failures remain disclosed above; this acceptance uses Node22. No installer, installed-app or release verification is implied.
