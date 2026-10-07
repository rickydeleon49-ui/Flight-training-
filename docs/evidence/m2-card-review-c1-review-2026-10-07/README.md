# Independent C1 review evidence — 7 October 2026

Reviewed source base: `73b15976343d2d2a1525e0426dbe6450e6afb850`. `reviewed-source-hashes.json` freezes the implementer's 37-path source manifest; these refer to the uncommitted C1 implementation, not the docs-only publication commit. All source hashes matched before and after independent verification. The original implementation evidence's 45 checksums verified; it is retained in the implementation clone, unchanged.

## Commands and receipts

Node/Rust PATH: `/opt/homebrew/opt/node@22/bin:/Users/rickymac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH`.

Xcode native/build commands explicitly used:

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX27.0.sdk
export CARGO_TARGET_DIR=/private/tmp/her-flight-deck-c1-xcode27-review-target
cargo test --locked --offline --manifest-path src-tauri/Cargo.toml --all-targets
npm run tauri -- build --debug --no-bundle -- --locked --offline
cargo clippy --locked --offline --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

| Receipt | Result |
| --- | --- |
| `focused-frontend.log` + `.exit` | `npx vitest run src/logic/cardScheduler.test.ts src/logic/cardIdentity.test.ts src/logic/localDay.test.ts src/data/cardReviewContract.test.ts src/data/cardReviewTauri.test.ts src/data/cardValidationParity.test.ts src/pages/StudyLibrary/CardReviewPanel.test.ts`: 105 passes, exit 0 |
| `xcode27-native.log` + `.exit` | 415 passes, six ignored, exit 0, fresh Xcode target |
| `xcode27-desktop-build.log` + `.exit` | frontend TypeScript/Vite plus native desktop compile/link, exit 0; no bundle/installer |
| `xcode27-clippy.log` + `.exit` | exit 0 |
| `fmt.log` + `.exit` | exit 0 |
| `toolchain-binary.txt` | selected Xcode/SDK/compiler/host and Mach-O metadata, exact commands/exits |
| `diagnostic-frozen.log` + `.exit` | `npx vitest run src/pages/StudyLibrary/CardReviewCodexReview.test.ts`: two controls pass, four defects fail, exit 1, no unhandled errors |

## Frozen diagnostic and exploratory receipts

Copy `diagnostics/CardReviewCodexReview.test.ts.txt` verbatim to the absent temporary source path above in the exact submitted source. It exercises the production hook, using deterministic held repository responses; the ordinary-start and single-page controls pass. No app/database/profile/provider/network is involved in this diagnostic. The independent affected suites separately exercise real SQLite drivers and the real provider.

Earlier `navigation-paging-diagnostic.log`, `diagnostic-final.log` and `diagnostic-published.log` are exploratory receipts, preserved. The first two include an unkeyed material-change probe: MaterialDetail actually remounts on routes, so that is not a production route finding. The published/frozen test replaces contentKey on the same material; the frozen receipt supersedes all earlier counts. Temporary diagnostic source was removed after execution. No production source was corrected by the reviewer.

`SHA256SUMS` hashes every file in this evidence directory except itself, rooted here. Native/Xcode evidence can be reused if the correction leaves those areas unchanged. A declared macOS 12 target is not a macOS 12 runtime test; no app launch, installed tests, signing or release took place.

Raw console receipts retain tool-generated whitespace byte-for-byte. Authored documents and diagnostic source pass whitespace checks; raw `.log` output is excluded from that formatting check.
