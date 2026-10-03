# Mac installed readiness and signing preparation — 3 October 2026

Prepared from [Claude's installed-readiness prompt](CLAUDE_MAC_INSTALLED_READINESS_PREPARATION_PROMPT_2026-10-03.md). **This is preparation, not installed verification.** No app was built, installed, launched, signed, notarized, tagged or released. No account, keychain, Gatekeeper or quarantine setting was touched. Every installed check below is **UNVERIFIED**. This is the implementer's report and **not Codex acceptance**.

**Corrected on 3 October 2026 after [Codex's readiness review](MAC_INSTALLED_READINESS_REVIEW_2026-10-03.md) (READINESS-R1 to R4, plus the signing-environment clarification); [accepted by Codex for source integration](MAC_INSTALLED_READINESS_ACCEPTANCE_2026-10-03.md).** The correction map is in §10. Earlier receipts are kept as historical evidence.

| Item | Value |
| --- | --- |
| Branch / base | `codex/mac-installed-readiness-preparation`, created from clean `main` `8b159485a66804a368dde5f4d7eea596b63bbfcc` (PR #54), no upstream |
| Roles | Implementer: Claude (Mac). Reviewer / Git coordinator: Codex. A2 production source: Windows owner (unchanged). |
| Delivered | [read-only preflight](../scripts/mac-readiness-preflight.mjs) and its [usage reference](MAC_READINESS_PREFLIGHT.md); 34 focused tests (17 at first delivery); original and corrected host receipts; this runbook, including the signing decision package and a blank receipt template; [evidence](evidence/mac-installed-readiness-preparation-2026-10-03/README.md) |

**Owner actions still needed** (§3 and §4):

1. Provide a dedicated **standard** (non-administrator) macOS test account.
2. Decide on Developer ID signing and notarization, and on the lane (CI or local).
3. Provision the credentials yourself, in the chosen secure location.
4. Approve a version and identity for any future signed candidate.

## 1. Readiness boundary audit

Key:

- **Configured:** the repository says so.
- **Observed:** seen on this Mac today or recorded with evidence.
- **Unavailable:** cannot be observed here.
- **Unverified:** not yet observed.

| Prerequisite | Source / configuration reference | Observed evidence | State |
| --- | --- | --- | --- |
| Bundle identifier `com.herflightdeck.app` | `src-tauri/tauri.conf.json` `identifier`; asserted by `.github/workflows/build-desktop.yml` against the mounted app's `Info.plist` | Preflight R-IDENTIFIER PASS today. The packaged app in the 2 Oct local DMG had it ([Mac report](MAC_SMOKE_RESULTS_2026-10-02.md)). | Configured; observed in source and in one local artifact |
| Minimum macOS 12.0 | `tauri.conf.json` `bundle.macOS.minimumSystemVersion`; `scripts/release-policy.json` `platformDistribution.macos.minimumSystemVersion` | R-MIN-MACOS PASS. `LSMinimumSystemVersion=12.0` in the 2 Oct local app. | Configured; macOS 12 **runtime unverified and unavailable here** |
| App version 0.5.3 | `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`; `release-policy.json` `candidateVersion` | R-VERSION and R-POLICY PASS (five sources agree) | Configured and consistent. 0.5.2 is permanently retired. |
| Executable architecture arm64 | `release-policy.json` `architecture: aarch64`; release and build lanes on `macos-15` (Apple Silicon runners); `build-desktop.yml` checks `file … \| grep arm64` | 2 Oct local app: Mach-O arm64. The frozen DMG's executable has not been inspected on this Mac. | Configured; observed for the local artifact only |
| Host and toolchain | — | **Today (2026-10-03):** macOS **27.0.1 (26A434)**, Mac17,3, Apple M5, arm64 native (not translated). Node v22.23.3, npm 10.9.9, rustc and cargo 1.99.0, host `aarch64-apple-darwin`. The 2 Oct report recorded **26.6 (25G72)**; later 3 Oct reports recorded 27.0.1. No upgrade history is claimed, only these observations. | Observed |
| Explicit compatible SDK | Native builds export `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` | H-SDK PASS, because SDK 26.5's metadata reads `Version` 26.5, the version with recorded build evidence (not merely because the directory exists). The default SDK is **27.0** (CommandLineTools); on 2 Oct it failed Rust linking (TAPI), and 26.5 passed. | Observed; the default-SDK incompatibility is an environment prerequisite, not changed here |
| Build lanes | `build-desktop.yml` (manual test DMG plus metadata check); `release.yml` (version gate, private CI artifacts or a private draft, `SHA256SUMS.txt`, Windows hold) | Workflows read; nothing triggered | Configured |
| Signing / notarization configuration | `tauri.conf.json` has no `signingIdentity`, `hardenedRuntime`, `entitlements` or `providerShortName` set. Workflows reference no `APPLE_*` secret names. | R-SIGNING-CONFIG USER_ACTION. The 2 Oct local app: ad hoc linker signature, no TeamIdentifier, Gatekeeper assessment exit 1, no stapled ticket. | **Not configured.** Whether GitHub holds Apple secrets is **unverified**; absent references do not prove absence. Credentials are **unavailable** to this task. |
| Installed-test account and profile isolation | Data root: `app_config_dir()` (`src-tauri/src/storage.rs`), i.e. `~/Library/Application Support/com.herflightdeck.app` with `her-flight-deck.db`, `documents/`, `backups/` and the non-backed-up `gemini-key` file (`src-tauri/src/secrets.rs`). No environment override redirects it. | P-TEST-ACCOUNT USER_ACTION. The owner confirmed on 2 Oct that no dedicated account exists, and none has been provided since. | **Unavailable**; blocks every installed phase |
| Source identity for testing | — | This branch's HEAD `8b15948` plus uncommitted tooling. R-SOURCE is UNVERIFIED (dirty) until Codex commits. | Observed |
| Artifact identity for testing | See §2 | Recorded identities only; no artifact on this Mac was hashed today (none was supplied; the repo's own bundle folder does not exist) | Configured (recorded); not re-observed |

**Production changes needed:** none were found for this preparation. The signing configuration is a future, owner-approved change (§4.4).

## 2. Artifact lanes: what each artifact can support

| Artifact | Identity | Can support | Cannot support |
| --- | --- | --- | --- |
| **Frozen private v0.5.3 draft** (do not rebuild, re-sign, replace or retag) | `Her.Flight.Deck_0.5.3_aarch64.dmg`, 4,511,142 bytes, SHA-256 `de81be50122275104ca9e6791162a7bac6cd43a672c5580d5fbc509b5d16efec`; workflow run `36515016063`, commit `41464607ff85d0a4cf0b837c19b400d8392dfec4` | Under the checklist's Exact-Installer Invariant: exact-byte identity, packaging metadata, the observed first-launch and Gatekeeper behavior **of those bytes**, and installed smoke observations of that candidate | Approval. The checklist records it as a frozen candidate with known source defects. A1, A3 and A4 were later fixed on main; A2 is still pending its Windows owner. Passing tests on it therefore does not make it approvable. It does not certify later source. |
| **Local source-evaluation DMG (2 Oct)** | `Her Flight Deck_0.5.3_aarch64.dmg`, 4,525,420 bytes, SHA-256 `e50975dce2db564a3623209c8e73f124fbc0c0ebc6010e7df5cf7c435a05eb37`, from `main` `5e388bf` | Source and packaging validation; read-only metadata and signature inspection | Release or approval. Rebuilt bytes have a new identity. |
| **Future signed and notarized candidate** | Does not exist. It needs its own owner-approved version decision, build-run identity, `SHA256SUMS.txt` entry and hash. | Its own exact-byte installed testing | It cannot replace, or inherit approval from, the frozen artifact. Signing and stapling change the bytes. |

## 3. Owner checklist: the dedicated test account

This is plain-language and for the owner. **Claude does not create the account.**

1. On this Mac, open **System Settings → Users & Groups → Add User…**.
   - Choose **Standard**, not Administrator.
   - Give it a neutral name, for example "HFD Test".
   - Use a password you keep yourself; never paste it into chat or Git.
2. Do **not** sign that account into your Apple Account or iCloud, and do not copy any personal files into it. Add no real flight-training PDFs, databases, backups or Gemini keys.
3. Tell the tester (Claude or Codex) only that the account exists and that its first login is complete. Do not share its password.
4. Decide which artifact the first run uses: the frozen draft, or a later approved signed candidate (§2). Provide its download location; the tester verifies the hash.
5. When testing ends, you may delete the whole test account. The tester never deletes app data inside your own account.

### How the tester confirms isolation

Run these in the test account's Terminal. Record only the results in the right-hand column, never names or paths.

| Check | Command | Record |
| --- | --- | --- |
| Not an administrator | `id -Gn \| tr ' ' '\n' \| grep -qx admin && echo ADMIN \|\| echo STANDARD` | STANDARD |
| Not the owner's account | Owner confirms verbally; do not record usernames | confirmed yes/no |
| App data folder empty or absent before the first launch | `test -e "$HOME/Library/Application Support/com.herflightdeck.app" && echo PRESENT \|\| echo ABSENT` | ABSENT |
| No Gemini key carried over | covered by the row above, since the key lives inside that folder | — |
| Synthetic fixtures only | `node scripts/generate-pdf-fixtures.mjs "$TMPDIR/hfd-fixtures"` (in a checkout inside the test account) and compare with the checklist's three hashes | hashes match yes/no |
| Intended data path after the first launch | `test -f "$HOME/Library/Application Support/com.herflightdeck.app/her-flight-deck.db" && echo DB_PRESENT` | DB_PRESENT |

The preflight (§5) can run inside the test account, but no flag can prove isolation; this table is the evidence.

## 4. Signing decision package (Developer ID, outside the Mac App Store)

### 4.1 Primary sources

Accessed 2026-10-03.

| Source | Key points |
| --- | --- |
| [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/) | Use a **Developer ID Application** certificate outside the App Store. Config: `bundle.macOS.signingIdentity`. CI signing variables: `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `KEYCHAIN_PASSWORD`. Notarization uses either `APPLE_API_ISSUER`, `APPLE_API_KEY` and `APPLE_API_KEY_PATH` (App Store Connect API), or `APPLE_ID`, `APPLE_PASSWORD` (app-specific) and `APPLE_TEAM_ID`. `signingIdentity: "-"` is ad hoc signing and does not avoid the user approval prompt. The example workflow imports the certificate into a temporary keychain with `security import` and `security set-key-partition-list`. |
| [Apple Developer ID](https://developer.apple.com/developer-id/) | Developer ID certificates sign Mac software distributed outside the Mac App Store, so Gatekeeper can verify the developer. Only the team's **Account Holder** can create them. Notarization complements signing. Since 1 November 2023 the notary service accepts uploads only from `notarytool` or Xcode 14+, not `altool`. |
| [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) | Requirements: Developer ID signing, hardened runtime, secure timestamp, no `get-task-allow`. Submit with `notarytool`, authenticating with an App Store Connect API key (preferred), an app-specific password with Apple ID and team, or a stored keychain profile. Staple with `stapler`; stapling supports `.app`, `.dmg` and `.pkg` but not `.zip`. Without a stapled ticket, Gatekeeper checks online. |

This page renders client-side, so the summary above came from an automated reading of it. Re-read the page when implementing.

### 4.2 What this project currently configures

- `tauri.conf.json` sets no signing identity. Its hardened-runtime setting is the Tauri default, which must be confirmed on the first signed build. No entitlements file or provider short name is set.
- `release.yml` and `build-desktop.yml` build on `macos-15`; they never sign or notarize, and they reference no Apple secrets.
- `release.yml` already gives the right identity discipline: a main-only version gate, private artifacts or a draft, and `SHA256SUMS.txt`.
- The Gemini key is a file in the data folder, not a keychain item, precisely because unsigned builds changed identity on each update (`src-tauri/src/secrets.rs`). A stable Developer ID identity would make keychain storage viable later; that is a separate, unassigned decision.

### 4.3 Owner information and responsibilities

| Needed | Who | Notes |
| --- | --- | --- |
| Apple Developer Program membership (individual or organization), and who the **Account Holder** is | Owner | Only the Account Holder can create the Developer ID Application certificate |
| Team ID | Owner | Not secret; may be shared in an issue or document |
| Plan eligibility for private-repository required reviewers, then the lane choice | Owner | See the eligibility note below |
| Creating the certificate (Account Holder) and an App Store Connect **API key** for notarization | Owner | Done in Apple's portals by the owner |
| Storing the credentials | Owner, in the browser | Only in a location the owner has confirmed is protected (see the eligibility note below). Never in chat, Git, issues or logs. |
| Version and identity for the first signed candidate | Owner | It cannot reuse the frozen 0.5.3 bytes' approval; 0.5.2 is retired forever |
| Approval of the workflow diff (§4.4) | Owner and Codex review | Not changed in this task |

**Repository plan eligibility (unverified).** This repository is **private** and user-owned. GitHub's [deployments and environments reference](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), accessed 2026-10-03, says:

- On GitHub Free, Pro or Team, required reviewers and wait timers are available only for **public** repositories.
- Environment secrets in private repositories need GitHub Pro, Team or Enterprise.

The owner's actual plan is **not established** here. A named environment without a required-reviewer rule is **not** an approval gate. Ordinary repository secrets have no approval gate either: any workflow run that can reach them could read them.

**Conditional recommendation (owner decides after checking the plan):**

| If the owner's plan provides… | Lane |
| --- | --- |
| Required reviewers for this private repository's environments | **CI through `macos-signing`**, with the owner as required reviewer, restricted to `main`, plus the §4.4 workflow. This is the preferred lane. |
| Environment secrets but no required reviewers | Not recommended as the signing gate. If the owner still chooses it, document the accepted risk: deployment-branch restriction to `main` (if available), manual `workflow_dispatch` only, and the release workflow's existing main-only check. Codex reviews every workflow change touching it. |
| Neither (or unknown) | **Owner-reviewed local/manual signing** (below) |

**Owner-reviewed local/manual alternative:**

1. The owner, or a tester the owner supervises in person, uses a dedicated build account on this Mac. The Developer ID certificate goes in that account's login keychain, and `notarytool store-credentials` saves a keychain profile. No secret ever goes to GitHub.
2. Start from a CI release-lane build, recorded with its run ID and `SHA256SUMS.txt`, or a local build with `SDKROOT` set to 26.5. Then:
   - sign the app with hardened runtime and a timestamp
   - create and sign the DMG with its own identifier and a timestamp
   - notarize with `notarytool` and staple
3. Record a receipt: input hash, output hash, notarization submission ID and stapler result. Run the preflight with `--artifact … --expected-sha256 …` and, after the read-only mount, `--app … --assess`.
4. Codex reviews the receipt before that new identity is used for §6 testing or proposed for release.

Signing changes bytes, so the signed output is a **new** candidate identity.

The CI lane's benefits, when it is eligible:

- It keeps the existing exact-identity release lane: build run, draft, `SHA256SUMS.txt`.
- Credentials stay out of this Mac's keychains.
- The `macos-15` runner avoids the local default-SDK problem.

**Intended secret names** (environment `macos-signing`, only if the eligibility above is confirmed):

| Secret | Holds |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the exported Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <Name> (<TEAMID>)` |
| `APPLE_API_ISSUER` | API key issuer ID |
| `APPLE_API_KEY` | API key ID |
| `APPLE_API_KEY_P8` | the `.p8` key contents, written at run time to `APPLE_API_KEY_PATH` under `$RUNNER_TEMP` |

`KEYCHAIN_PASSWORD` is generated randomly per run, not stored.

### 4.4 Implementation sketch for later approval (not applied)

```diff
 # .github/workflows/release.yml  (build job, macOS matrix entry only)
+    environment: ${{ matrix.os == 'macos-15' && 'macos-signing' || '' }}
     steps:
       ...
+      - name: Prepare temporary signing keychain (macOS)
+        if: matrix.os == 'macos-15'
+        env:
+          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
+          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
+          APPLE_API_KEY_P8: ${{ secrets.APPLE_API_KEY_P8 }}
+        run: |
+          KEYCHAIN_PASSWORD="$(openssl rand -hex 24)"; echo "::add-mask::$KEYCHAIN_PASSWORD"
+          KC="$RUNNER_TEMP/hfd-signing.keychain-db"
+          echo "$APPLE_CERTIFICATE" | base64 --decode > "$RUNNER_TEMP/cert.p12"
+          security create-keychain -p "$KEYCHAIN_PASSWORD" "$KC"
+          security set-keychain-settings -lut 3600 "$KC"
+          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KC"
+          security import "$RUNNER_TEMP/cert.p12" -k "$KC" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
+          security set-key-partition-list -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KC"
+          security list-keychains -d user -s "$KC" $(security list-keychains -d user | tr -d '"')
+          rm "$RUNNER_TEMP/cert.p12"
+          umask 077; printf '%s' "$APPLE_API_KEY_P8" > "$RUNNER_TEMP/AuthKey.p8"
+          echo "APPLE_API_KEY_PATH=$RUNNER_TEMP/AuthKey.p8" >> "$GITHUB_ENV"
-      - run: npm run tauri build -- --bundles ${{ matrix.bundles }}
+      - run: npm run tauri build -- --bundles ${{ matrix.bundles }}
+        env:
+          APPLE_SIGNING_IDENTITY: ${{ matrix.os == 'macos-15' && secrets.APPLE_SIGNING_IDENTITY || '' }}
+          APPLE_API_ISSUER: ${{ matrix.os == 'macos-15' && secrets.APPLE_API_ISSUER || '' }}
+          APPLE_API_KEY: ${{ matrix.os == 'macos-15' && secrets.APPLE_API_KEY || '' }}
+      - name: Verify signature, notarization and staple (read-only)
+        if: matrix.os == 'macos-15'
+        run: |
+          dmg=$(find src-tauri/target/release/bundle/dmg -name '*_aarch64.dmg' -print -quit)
+          m="$RUNNER_TEMP/hfd-verify"; mkdir -p "$m"
+          hdiutil attach -quiet -readonly -nobrowse -mountpoint "$m" "$dmg"; trap 'hdiutil detach -quiet "$m"' EXIT
+          app="$m/Her Flight Deck.app"
+          codesign --verify --deep --strict "$app"
+          codesign -dv --verbose=2 "$app" 2>&1 | grep -E '^(Authority=Developer ID Application|TeamIdentifier=|Timestamp=)' | sed 's/:.*(/: <redacted> (/'
+          codesign -dv "$app" 2>&1 | grep -q 'flags=.*runtime'
+          spctl --assess --type execute -vv "$app"
+          xcrun stapler validate "$dmg"
+      - name: Remove temporary signing material
+        if: always() && matrix.os == 'macos-15'
+        run: |
+          security delete-keychain "$RUNNER_TEMP/hfd-signing.keychain-db" 2>/dev/null || true
+          rm -f "$RUNNER_TEMP/AuthKey.p8" "$RUNNER_TEMP/cert.p12"
```

**Before applying this sketch:**

- Confirm against the current Tauri docs whether the CLI already imports `APPLE_CERTIFICATE` itself. If it does, drop the manual import step, but keep the cleanup.
- Confirm the hardened-runtime default.
- A conditional `environment:` expression may not be accepted for a matrix entry. A separate macOS-only build job bound to `macos-signing` is the simpler, reviewable form.
- Add entitlements only if a signed test build demonstrably needs them; the webview runs out of process.
- Verify that `stapler` succeeds on the DMG.
- Add a `release-safety` test asserting that the macOS job, and only it, uses the protected environment, and that no secret is echoed.

The Windows job and its hold stay untouched.

**After a signed build:**

1. The `SHA256SUMS.txt` hash becomes the new candidate identity.
2. Run the preflight against it: `--artifact … --expected-sha256 …`, then the read-only mount and `--app … --assess`.
3. Run the §6 phases on those exact bytes in the test account.

**Never:** propose or use `spctl --master-disable`, `xattr -d com.apple.quarantine`, "Open Anyway" or Control-click Open as a workaround.

## 5. Preflight

See the [usage reference](MAC_READINESS_PREFLIGHT.md). It runs in default read-only mode:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH"
node scripts/mac-readiness-preflight.mjs --receipt "$TMPDIR/hfd-preflight.json"
```

Both host receipts are in the [evidence folder](evidence/mac-installed-readiness-preparation-2026-10-03/README.md). The original (schema `/1`) and the corrected (`/2`, 18:40Z) both report **9 PASS, 0 FAIL, 3 UNVERIFIED, 3 USER_ACTION, exit 0.** That is not ready.

## 6. Isolated installed smoke run (later, in the test account)

**Global prerequisites:**

- §3 isolation rows recorded.
- The artifact identity is verified before mounting (`shasum -a 256` or `--artifact … --expected-sha256`).
- The synthetic fixtures are generated in `$TMPDIR/hfd-fixtures` and their hashes match the [checklist test kit](MAC_PARITY_CHECKLIST.md#4-synthetic-non-sensitive-pdf-test-fixtures):
  - A `f6c593f9…`, 10 pages
  - B `0ba9a7e2…`, 1,050 pages
  - C `b5651eb6…`, 60 pages

Do not generate a new heavy set and do not repeat the A5 source measurements.

**Global stop:** a security **refusal** (scenario table below), a data-loss symptom, a crash at launch, or anything touching the owner's account. Record it and stop the dependent phases.

**First open: normal confirmation versus refusal.** Apple's [first-open guidance](https://support.apple.com/en-us/102445), accessed 2026-10-03, says that the first time you open an app downloaded from an identified developer outside the App Store, macOS asks you to confirm. That is expected behavior, not a failure.

| What macOS shows | Classification | What the tester does |
| --- | --- | --- |
| A confirmation that the app was downloaded from the Internet and asks whether to open it, offering an ordinary **Open** button | **Normal first-open confirmation** | Record the exact text, icon and buttons. Continue with **Open** only if: the artifact hash matches the recorded identity; the preflight shows `A-APP-SIGNATURE` PASS; and `A-GATEKEEPER` PASS when `--assess` was authorized. Otherwise stop. Seeing this dialog is **not** itself a PASS; phase 1 passes only on the observed outcomes in its row. |
| macOS cannot verify the developer, or the app is not notarized ("unidentified developer") | **Refusal** | Record and **STOP** |
| "Apple cannot check … for malicious software" (Move to Trash / Done) | **Refusal** | Record and **STOP** |
| "… is damaged and can't be opened", or malware detected and moved to Trash | **Refusal** | Record and **STOP** |
| "… will damage your computer" (revoked authorization) | **Refusal** | Record and **STOP** |
| Blocked by the Gatekeeper policy setting (for example App Store only) or a management profile | **Refusal** | Record and **STOP**; the owner decides any policy change. The tester never changes it. |

Always excluded: **Open Anyway**, Control-click Open, removing quarantine (`xattr -d com.apple.quarantine`), disabling Gatekeeper (`spctl --master-disable`) or any other security setting change. This runbook authorizes no installed run now.

**Installation scope (standard account, no elevation):**

- **Default:** install into the test account's own `~/Applications` (create it if absent) by dragging from the read-only-mounted image. A standard account can write there without administrator authentication. Copying with Finder from the mounted image avoids launching from the image itself.
- **If the owner wants `/Applications` specifically:** Finder asks for an administrator's name and password, because `/Applications` is admin-writable. The **owner** types those in person at that prompt. The tester never asks for, receives or records them, and never makes the test account an administrator.
- **Record which scope was used** in the receipt; app-location-dependent behavior may differ.
- **Uninstalling** is the owner's choice. The tester may move only the app it installed, and only after the receipt is complete.

**Cleanup:** task-owned only. That means fixture copies in the test account's `$TMPDIR`, and backups and archives whose exact filenames were recorded. Never delete the app data folder or anything ambiguous; leave it for inspection, and the owner may delete the whole test account.

**Live Gemini** is excluded; it needs separate authorization.

| Phase | Checklist IDs | Prerequisites | Action | Expected state | Evidence to capture | Safe stop | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Identity, install, first launch, signing, window | MAC-01, MAC-02, MAC-03 (current OS only), MAC-17, PERF-MAC-01 | Verified artifact hash; §3 rows | Read-only mount (§7); preflight `--app … --assess` (when authorized); copy to `~/Applications` (default scope) or, with owner-entered authentication, `/Applications`; open normally from Finder; on the **normal first-open confirmation**, choose Open per the scenario table; check version (About), resizing to the 1024×700 minimum, dialogs, keyboard and focus | The app reaches its first usable screen; version 0.5.3, or the candidate's version; metadata and signature checks match | Artifact name, size and hash; preflight receipt; installation scope; the exact text, icon and buttons of any first-open dialog, and its classification (normal or refusal); launch time; screenshots | **Any refusal in the scenario table: record it and STOP.** A normal confirmation is not a stop. Never bypass. | Detach the image; keep the installed app for later phases |
| 2. Import, relocation, Open, Reveal, folder | MAC-04, MAC-05, MAC-06, MAC-18 | Phase 1 passed; Fixture A | Import A through the native panel; rename or move the original; restart; Open (default viewer); Reveal in Finder; Settings → open data folder | The managed copy under `…/com.herflightdeck.app/documents/` survives; Open uses the default viewer; Reveal selects the file; the folder matches the displayed path | Fixture hash; managed-copy hash; screenshots; exact error text if any | Wrong folder, or a path outside the app folder | Restore the original fixture name in `$TMPDIR` only |
| 3. Metadata, tags, rejected save, retry, Cancel | MAC-04, MAC-11 (part), and A2 rows AR, AF and IN-01 in the [A2 package](MAC_A2_VERIFICATION_PREPARATION_2026-10-03.md) | Phase 2; a second synthetic PDF for replacement | Create, edit, replace and clear tags and fields; replace an attachment; Cancel a new import; Cancel an edit | No orphan or lost file; tags as shown | Before/after file list (names and hashes) of `documents/`; screenshots | Lost attachment or orphan: stop | none |
| 3b. A2-dependent: rejected save and retry conservation | AR-04 to AR-06, AF-03 to AF-06 | **PENDING the Windows owner's independently accepted A2 source** in a reviewed candidate | — | — | — | Not run until that source is in the tested artifact | — |
| 4. Splitting | MAC-09, MAC-10, PERF-MAC-03 | Fixtures B and C | Automatic split of B (more than 1,000 pages) and C (more than 50 MiB); manual valid range (C, pages 10–20) and invalid or fractional ranges | Parts no larger than 50 MiB and 1,000 pages; complete, ordered, non-overlapping coverage (B: all 1,050 pages in 2 parts, per the checklist; C: 1–58 and 59–60, per the accepted Mac source measurement; manual C pages 10–20 gives 11 pages); originals unchanged; invalid ranges refused; responsive UI | Part sizes and page ranges; original hashes before and after; peak memory (Activity Monitor); duration | OOM, frozen UI or a changed original: stop | Delete only the split records it created, through the app, if desired; never the folder |
| 5. Concurrency and backup | MAC-07, MAC-11, MAC-16 | Phases 2 to 4 data | Save a complete backup to `~/Downloads` while an autosave and a split run; then inspect the **exact** recorded file with `unzip -t` and `unzip -l`, and `node scripts/inspect-backup-credentials.mjs <exact file>` | Finalized archive; integrity OK; no `gemini-key` entries; bounded busy handling | Archive name, size and hash; `unzip -t` result; credential-inspector exit code (0 pass, 1 found, 2 error) | Partial or corrupt archive marked as success: stop | The recorded archive may be kept for phase 6 |
| 6. Restore, damage, restart, upgrade | MAC-08, PERF-MAC-04 | The phase 5 archive; a truncated copy in `$TMPDIR`; for upgrade, two **separately identified** artifacts | Restore the valid archive; attempt the truncated one; quit and relaunch; upgrade from the older identified build over its synthetic data | Records and document hashes conserved; damage refused with the original data intact; a pre-upgrade safety copy exists | Hash comparison table; error text; `backups/` listing (names only) | Any loss of the original data: stop | The truncated copy in `$TMPDIR` |
| 7. Offline saved study content | MAC-15, MAC-19 | A saved guide, cards or test exist (created via synthetic import data, **without** Gemini configured) | Disable networking; open the saved guide, flip cards, take the saved test | Saved content usable; generation clearly unavailable | Screenshots; notice text | Generation attempted silently | Re-enable networking |
| 8. WebKit, VoiceOver, macOS 12 | MAC-03, MAC-17 | Current macOS: available. **Early macOS 12: unavailable** (needs separate hardware or an owner-approved VM). | VoiceOver on the main flows, keyboard-only dialogs, reduced motion; repeat on macOS 12.x separately | Accessible labels, focus order, and modal fallbacks on 12.0–12.2 | Per-OS results recorded separately | — | — |

## 7. Read-only DMG inspection (separately authorized step)

The preflight never mounts. When an owner or reviewer authorizes inspecting a verified DMG:

```bash
M="$TMPDIR/hfd-ro-$$"; mkdir "$M"
hdiutil attach -readonly -nobrowse -mountpoint "$M" "<exact verified .dmg>"
node scripts/mac-readiness-preflight.mjs --app "$M/Her Flight Deck.app" --receipt "$TMPDIR/hfd-app-preflight.json"
hdiutil detach "$M" && rmdir "$M"
```

Adding `--assess` runs `spctl` and `stapler`; macOS may contact Apple during that. Nothing is copied or installed.

## 8. Blank installed-run receipt template

Copy this for each run. Leave a field empty, or write UNVERIFIED, until it is observed. **No outcome is prefilled.**

```text
Run date/time (UTC):
Tester role (Claude / Codex / owner):
Mac model / chip / macOS version and build:
Test account: standard (yes/no) · owner confirmed separate account (yes/no) · app data folder ABSENT before first launch (yes/no)
Artifact lane (frozen draft / approved signed candidate / other):
Artifact file name / bytes / SHA-256 / matches recorded identity (yes/no):
Source commit of artifact / build run:
Preflight receipt file and exit code:
Preflight: A-APP-SIGNATURE (display state / integrity state) · A-DMG-SIGNATURE (container) · A-GATEKEEPER verdict / source category / stapled ticket:
Installation scope (~/Applications default / /Applications with owner-entered authentication):
First-open dialog: none / normal confirmation / refusal · exact text and buttons:
Fixture hashes A / B / C match (yes/no):

Phase | Result (PASS / FAIL / BLOCKED / UNVERIFIED) | Evidence file(s) | Notes / exact dialog or error text
1 Identity, install, first launch, window        |  |  |
2 Import, relocation, Open, Reveal, folder       |  |  |
3 Metadata/tags/Cancel (non-A2)                  |  |  |
3b A2-dependent conservation                     | PENDING SOURCE |  |
4 Splitting (auto B, auto C, manual, invalid)    |  |  |
5 Concurrency, backup, integrity, credentials    |  |  |
6 Restore, damaged archive, restart, upgrade     |  |  |
7 Offline saved study content                    |  |  |
8 VoiceOver/WebKit (current) | macOS 12 (separate) |  |  |

Stopped at (phase / reason):
Cleanup performed (exact task-owned items only):
Items intentionally left (app data folder, recorded archives):
Live Gemini: not run (separately authorized only)
```

## 9. Limits, holds and the next gate

- **What is and isn't covered:** the preflight is source and host evidence. Its 34 tests are synthetic controls. None of it is installed evidence. Checklist outcomes are unchanged, because nothing installed was observed.
- **Unavailable here:** the test account, signing credentials and decision, early macOS 12, and a case-sensitive or symlinked user folder in an installed context.
- **Unchanged:**
  - macOS 12 and Windows support
  - versions and bundle identity
  - migrations and backups
  - the Windows hold on v0.5.1; 0.5.2 retired; the frozen v0.5.3 candidate
  - the open-source and M2 gates
- **No Windows-owner message was sent.** The A2 source gate stands.

**Next eligible step:** phase 1 in the test account, on the artifact the owner selects.

- **Gate:** the owner provides the test account (§3). For a distributable candidate, the owner also confirms private-repository environment eligibility, makes the signing decision and provisions credentials (§4.3). Codex then reviews either the §4.4 workflow change or the owner's local-signing receipt.

## 10. Correction map: Codex readiness review (3 October 2026)

All four findings are corrected; the package is [accepted by Codex for source integration](MAC_INSTALLED_READINESS_ACCEPTANCE_2026-10-03.md).

**Starting state:** all ten handed-off files matched their reviewed hashes. The script was `b9bd50c1…` and the tests were `59bee8f9…`. Receipts: the [correction receipt](evidence/mac-installed-readiness-preparation-2026-10-03/readiness-correction-receipt-2026-10-03.txt) and Codex's [review evidence](evidence/mac-installed-readiness-review-2026-10-03/README.md). The historical diagnostic is preserved; it still reproduces 7 unmet expectations against the reviewed bytes and refuses the corrected bytes through its hash guard.

| Finding | Fix | Regressions (in `src/logic/macReadinessPreflight.test.ts`) |
| --- | --- | --- |
| **R1** Signature PASS without integrity; app and DMG conflated; exit codes ignored | `A-APP-SIGNATURE` needs a display that exited 0 and `codesign --verify --deep --strict` exiting 0, plus the expected identifier, Developer ID Application, runtime, team and timestamp. `A-DMG-SIGNATURE` checks the container (`--verify --strict`, no runtime or bundle-ID requirement); `A-INNER-APP-SIGNATURE` stays UNVERIFIED. Every observation command now counts only on exit 0 (`okOut`); `spctl` and `stapler` verdicts need consistent exit codes. | "R1: a healthy Developer ID app passes only after display and strict deep verification both succeed" · "R1: intact display metadata with a failed strict verification (sealed resource) is FAIL" · "R1: a nonzero display command with plausible metadata is UNVERIFIED and contributes no fields" · "R1: missing codesign, and a bounded verification timeout or truncation, stay UNVERIFIED" · "R1: a wrong signature identifier on the app is FAIL even with verified integrity" · "R1: ad hoc and unsigned apps remain FAIL" · "R1: a healthy signed disk image without an app runtime flag passes as a container; its inner app stays UNVERIFIED" · "R1: an unsigned disk image is FAIL; a container failing verification is FAIL" · "R1: observation commands that exit nonzero never yield PASS from their printed output" · "R1: plutil and lipo results count only when they exit 0" · "fails a bundle metadata mismatch, and Gatekeeper output is trusted only with a consistent exit code" |
| **R2** SDK presence reported as compatibility | H-SDK separates selection (`--sdk`, `SDKROOT` or default), presence, directory type, metadata and version. Only 26.5 (with evidence) passes; 27.0 fails; other or unidentified versions are UNVERIFIED. Configuration minimums are validated before comparison. | "R2: only the evidenced SDK 26.5 passes, selected by --sdk or by an inherited SDKROOT" · "R2: the recorded incompatible SDK 27.0 fails whether selected by --sdk or SDKROOT" · "R2: another present version without build evidence is UNVERIFIED, not PASS" · "R2: missing, malformed and unreadable SDK metadata never pass" · "R2: an absent path and a regular file fail, and synthetic absence never falls through to this Mac's SDK" · "R2: a malformed configured minimum macOS is reported as invalid and never compared" |
| **R3** Arbitrary alphabetic output in receipts | Fixed categories for authorities, `spctl` sources, flags, Rust host, developer directory, branch and policy status. Identifiers are reported as match or differ; no paths; artifact names only when they equal a recorded identity. CLI errors echo no values or raw messages. The home/username replacement is removed. | "R3: unknown certificate holders, authorities and assessment sources become fixed categories in JSON and text" · "R3: recognized authority and assessment categories remain useful" · "R3: CLI errors never echo argument values, private paths or raw error messages" |
| **R4** Phase 1 stopped on the normal first-open confirmation | Scenario table in §6 separates the normal confirmation from refusals. Installation scope defaults to `~/Applications`, with owner-entered authentication for `/Applications`. Phase 1, global stops and the receipt template are aligned. | Runbook review, not a code test |
| Signing clarification | §4.3: private-repository required-reviewer eligibility is unverified. The recommendation is conditional, with an owner-reviewed local/manual alternative. | Runbook review |

**Old versus corrected:** the corrected test file was run in an isolated temporary tree against copies of each script; the primary files were never modified.

| Script | Result |
| --- | --- |
| Reviewed script (`b9bd50c1…`) | **23 failed / 11 passed** of 34, including every R1, R2 and R3 regression |
| Corrected copy | **34 passed** |

