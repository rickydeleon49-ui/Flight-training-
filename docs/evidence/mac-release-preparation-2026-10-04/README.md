# Evidence: Mac release preparation for independent review — 4 October 2026

Evidence package accompanying [`docs/MAC_RELEASE_PREPARATION_2026-10-04.md`](../../MAC_RELEASE_PREPARATION_2026-10-04.md).

## Summary

- **Host:** macOS 27.0.1 (26A434), Apple M5, arm64
- **Toolchain:** Node v22.23.3, npm 10.9.9, rustc 1.99.0, cargo 1.99.0, explicit SDK 26.5
- **Tested starting source commit:** `50568143a4c4aef04e54eba88bfb22f0974cafe4` on branch `claude/mac-release-preparation-2026-10-04`
- **Owner direction:** "review and no testing account ill wait for the release."
- **Owner membership status:** No Apple Developer Program membership.
- **Local build result:** Exit 0 (`npm run tauri build -- --bundles dmg`), receipt in [`build-exit.txt`](build-exit.txt).
- **Built artifact:** `Her Flight Deck_0.5.3_aarch64.dmg` (4,561,979 bytes, SHA-256 `1ac53e566e85043260dbe74ef9d3b90c91460e412e1d88f534947f91396d64c0`).
- **Classification:** **Local build evidence, not the frozen release candidate and not approved for installation/distribution.**
- **Application launch:** Never launched or installed. Zero access to owner application-data directory.
- **Overall status:** **Accepted as preparation evidence and an inactive proposal** ([independent acceptance](../../MAC_RELEASE_PREPARATION_ACCEPTANCE_2026-10-04.md)); signing/installed/release gates remain open.

---

## Artifact distinction

| Category | Artifact | Size | SHA-256 | Target Commit | Status / Notes |
| --- | --- | --- | --- | --- | --- |
| **Frozen GitHub Draft** | `Her.Flight.Deck_0.5.3_aarch64.dmg` | 4,511,142 bytes | `de81be50122275104ca9e6791162a7bac6cd43a672c5580d5fbc509b5d16efec` | `4146460...` | Frozen historical candidate draft; preserved unchanged; do not republish, replace or retarget. |
| **New Local Build Evidence** | `Her Flight Deck_0.5.3_aarch64.dmg` | 4,561,979 bytes | `1ac53e566e85043260dbe74ef9d3b90c91460e412e1d88f534947f91396d64c0` | `50568143...` | Local packaging evidence only; ad-hoc signed; strict verification fails; not approved for install/release. |

---

## Build log provenance and exit receipt

- **Raw local build output:** `/tmp/hfd-local-build-2026-10-04.log` (16,160 bytes, SHA-256 `898751ccd92b8e31f0784caa12e2e9d01929ffbf20e3b6de9520801f0cad558d`). Preserved untouched.
- **Tracked publishable build log:** [`build-output.txt`](build-output.txt) (16,159 bytes, SHA-256 `4205a131cb041f474f1f45c97c22b009fbe915d5a56bb2472410e93748a7a03a`). Exactly one terminal newline was trimmed from raw output; repository ignore policy is unchanged.
- **Ignored local log copy:** `build-output.log` (16,159 bytes, gitignored).
- **Direct build exit receipt:** [`build-exit.txt`](build-exit.txt) (2 bytes `0\n`, SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`).

---

## Read-only readiness preflight runs

The preflight tool was executed in distinct invocations across repository and artifact targets:

1. **Initial repository preflight (JSON):** [`preflight-initial.json`](preflight-initial.json) (6,555 bytes, SHA-256 `4c4bb08e...`), generated `2026-10-04T22:34:27.232Z` on clean starting checkout. Summary: `10 PASS · 0 FAIL · 2 UNVERIFIED · 3 USER_ACTION`, exit `0`.
2. **Initial repository preflight (Text):** [`preflight-initial.txt`](preflight-initial.txt) (2,068 bytes, SHA-256 `3a90c08f...`), generated `2026-10-04T22:38:52.176Z` after building in dirty checkout. Summary: `8 PASS · 0 FAIL · 4 UNVERIFIED · 3 USER_ACTION`, exit `0` (`R-SOURCE` and `H-TOOLCHAIN` unverified).
3. **Built DMG container inspection:** [`preflight-local-dmg.json`](preflight-local-dmg.json) / [`preflight-local-dmg.txt`](preflight-local-dmg.txt). Summary: `10 PASS · 1 FAIL · 8 UNVERIFIED · 3 USER_ACTION`, exit `1` (`A-DMG-SIGNATURE: FAIL`, `A-GATEKEEPER: UNVERIFIED` — assessment not run).
4. **Mounted application inspection:** [`preflight-local-app.json`](preflight-local-app.json) / [`preflight-local-app.txt`](preflight-local-app.txt). Summary: `11 PASS · 1 FAIL · 4 UNVERIFIED · 3 USER_ACTION`, exit `1` (`A-APP-SIGNATURE: FAIL` — ad-hoc signature, strict verification failed).

---

## Evidence files inventory

| File | Size (bytes) | SHA-256 | Description |
| --- | --- | --- | --- |
| [`build-exit.txt`](build-exit.txt) | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` | Direct build command exit receipt (`0\n`) |
| [`build-output.txt`](build-output.txt) | 16,159 | `4205a131cb041f474f1f45c97c22b009fbe915d5a56bb2472410e93748a7a03a` | Tracked build log (exit 0, one trailing newline trimmed from raw log) |
| [`local-artifact-inspection.txt`](local-artifact-inspection.txt) | 3,823 | `77d49a569046c4e07c688dd4f8d343227f48ef6e286d53332b193492250e62dc` | Exact command invocations, codesign displays, architecture, and verification exits |
| [`preflight-initial.json`](preflight-initial.json) | 6,555 | `4c4bb08e3a71fe4d64911bfeab90e65ebbb084f489bbfcb9db6ea3ae0af41511` | Initial repository readiness preflight before build on clean checkout (exit 0) |
| [`preflight-initial.txt`](preflight-initial.txt) | 2,068 | `3a90c08f8b4f3a7e576560bfd7e2f496e5fbc38ce9566f768ea30d5991512369` | Initial repository readiness preflight text output post-build on dirty checkout (exit 0) |
| [`preflight-local-app.json`](preflight-local-app.json) | 9,299 | `70fbaa189e29e96d9a1a02f20317b7c71b05a5f453b70a600137482df88c8b09` | Read-only preflight on mounted inner `.app` (exit 1: `A-APP-SIGNATURE FAIL`) |
| [`preflight-local-app.txt`](preflight-local-app.txt) | 2,600 | `cb91eb71cef0be9f090019ae85b66bb789e49c6adddb34d971f5df1d58877000` | Read-only preflight text output for mounted `.app` |
| [`preflight-local-dmg.json`](preflight-local-dmg.json) | 9,138 | `e41dc5b7bc66465ed80b1688bcb62d1d55466048f5fdba7cac190199f3a57e66` | Read-only preflight on built `.dmg` container (exit 1: `A-DMG-SIGNATURE FAIL`) |
| [`preflight-local-dmg.txt`](preflight-local-dmg.txt) | 2,808 | `c58dbb57b967e0ae384523f0dee26e4c4181762462c15bb5837cf1815c14f05c` | Read-only preflight text output for built `.dmg` container |
| [`proposed-macos-signing.patch`](proposed-macos-signing.patch) | 14,024 | `048c3e8624190557f7aaa06c6dd4c2b828550944c6cec6f8b8e4bf04407c6deb` | Valid unified diff applying cleanly via `git apply --check` against base `release.yml` |
| [`proposed-release-workflow.yml`](proposed-release-workflow.yml) | 27,840 | `3dcba2968c110bdf8d3e593e13e57768393ab47ed0c664ed009ddcedcb8793e9` | Complete proposed workflow YAML with job-level manual/main guard, strict verification & cleanup |
| [`results.json`](results.json) | 10,223 | `17111d387c4fa326d1bc31077eaca7d7873df319bb215cb3b473b951a6cf9e05` | Structured results JSON: candidate audit, blockers inventory, and preflight counts |
| [`signing-proposal-validation.txt`](signing-proposal-validation.txt) | 3,559 | `1ddcccadd7a0689a49b0e6ac60234970c26183e11a72614f99957efe3afa0b12` | Execution log of mock validator confirming all 41 synthetic validation checks pass exit 0 (32 executable behavior cases, 9 structural checks) |
| [`validate-signing-proposal.mjs`](validate-signing-proposal.mjs) | 42,477 | `4c8d6110963edde02df0e0b45c6f03adbb06551392644cf88f6c508ea83c5da5` | Standalone mock runner testing AST, application, fail-closed guards, identity assertions, cleanup error handling |

---

## Exact command verification and exits

| Command | Target / Scope | Exit code | Output summary |
| --- | --- | --- | --- |
| `npm run tauri build -- --bundles dmg` | Local build | `0` | Built frontend in 2.05s, compiled Rust in 1m 37s, created DMG at `src-tauri/target/release/bundle/dmg/Her Flight Deck_0.5.3_aarch64.dmg` |
| `hdiutil attach -quiet -readonly -nobrowse -mountpoint /tmp/hfd-mnt "..."` | Task-owned DMG | `0` | Mounted read-only |
| `file "/tmp/hfd-mnt/Her Flight Deck.app/Contents/MacOS/her-flight-deck"` | Inner executable | `0` | `Mach-O thin arm64` |
| `plutil -extract CFBundleIdentifier raw ...` | Info.plist | `0` | `com.herflightdeck.app` |
| `codesign -dvv "/tmp/hfd-mnt/Her Flight Deck.app"` | Inner app bundle | `0` | `flags=0x20002(adhoc,linker-signed)`, `TeamIdentifier=not set` |
| `codesign --verify --deep --strict "/tmp/hfd-mnt/Her Flight Deck.app"` | Strict deep verify | `1` | `code has no resources but signature indicates they must be present` |
| `codesign -dvv "Her Flight Deck_0.5.3_aarch64.dmg"` | DMG container | `1` | `code object is not signed at all` |
| `hdiutil detach /tmp/hfd-mnt` | Mount point | `0` | Detached cleanly |
| `node scripts/mac-readiness-preflight.mjs --artifact "..."` | Built DMG container | `1` | `10 PASS, 1 FAIL (A-DMG-SIGNATURE), 8 UNVERIFIED, 3 USER_ACTION` |
| `node scripts/mac-readiness-preflight.mjs --app "..."` | Mounted app bundle | `1` | `11 PASS, 1 FAIL (A-APP-SIGNATURE), 4 UNVERIFIED, 3 USER_ACTION` |
| `git apply --check proposed-macos-signing.patch` | Stated base release.yml | `0` | Clean read-only patch application against base workflow |
| `node validate-signing-proposal.mjs` | Proposal validation runner | `0` | 41/41 synthetic validation checks pass cleanly (32 executable behavior cases, 9 structural checks) |

The submitted hash manifest records the implementation handoff before coordinator status/editorial reconciliation. Use the [reviewed submission inventory](../mac-release-preparation-acceptance-2026-10-04/reviewed-submission-hashes.json) for that snapshot and [publication inventory](../mac-release-preparation-acceptance-2026-10-04/publication-artifact-hashes.json) for final published files. Original receipts and executable proposal bytes are preserved.
