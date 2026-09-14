# Her Flight Deck 0.5.2 — release preparation

**Status:** Version and release notes prepared; `v0.5.2` has not been tagged or published. `v0.5.1` remains the latest published release. Keep the tag step until the installed Apple Silicon Mac smoke test below is recorded as passed. A hosted DMG build confirms packaging, not the installed application's behavior.

## What is prepared

- `package.json`, both root package-lock versions, `src-tauri/Cargo.toml`, the app package in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` all say `0.5.2`. The release workflow checks these four source files before it builds or publishes.
- The bundle identifier remains `com.herflightdeck.app`, and shipped migrations and backup formats are unchanged by this preparation. The version change is needed for the app's first-run safety-copy behavior when upgrading from `0.5.1`.
- `docs/releases/v0.5.2.md` holds the user-facing change summary for reference. The existing tag-driven release workflow writes installer, update, and checksum instructions and needs no workflow change for `0.5.2`.
- No tag, GitHub Release, or installable file has been published by this preparation. A test installer or CI artifact is for validation only.

## Automated evidence

On the Windows x64 development host, `npm ci` reported zero vulnerabilities; `npm test` passed 337 tests (two manual benchmarks skipped); `npm run build` passed; `cargo fmt --check`, strict Clippy, and `cargo test` passed 88 Rust tests (two intentionally ignored benchmarks). `npm run tauri build -- --bundles nsis` produced `Her Flight Deck_0.5.2_x64-setup.exe` (3,643,726 bytes, SHA-256 `2B934CF58520FE748E67EEA9D1FE8DE6A7E98171098A16AD677A7E2FA6174E65`). The hosted Apple Silicon 0.5.2 package check is recorded in the release-preparation PR. The same code before this version-only preparation passed [main CI](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/34776515488) and an [Apple Silicon build](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/34808668123).

## Installed Mac release gate

Use an Apple Silicon Mac running macOS 12 or newer and a copy of non-sensitive test data. Use the **0.5.2 test DMG built from this prepared commit**. Record the Mac model, macOS version, DMG filename, source commit, observations, and whether every check passes:

1. Install the DMG to Applications and launch the unsigned app using System Settings → Privacy & Security → Open Anyway if prompted. Confirm the app opens, shows `0.5.2`, and retains the existing library when installed over `0.5.1`.
2. Import a public PDF, move or delete the original upload, then open the managed copy in Preview. Use **Show in Finder** and Settings **Open folder**; confirm both reveal the paths shown by the app.
3. Automatically split a long or image-heavy PDF. Confirm responsive progress, no database-lock alert, original unchanged, every labeled part at most 50 MiB and 1,000 pages, a separate library record, and a study-guide action. Try a failure and confirm no orphan file or record.
4. Manually split a page range with and without a title. Check invalid range and oversized-output messages, the safety copy, and failure cleanup.
5. With a test Gemini key and public PDF, create a study guide, flashcards, and practice test. Check busy/429 messaging if it occurs. Confirm the key is absent from logs and backups. Settings still accepts the key in a webview password field; the stricter native-entry limitation remains documented in `MAC_AUDIT_2026-09-12.md`.
6. During ordinary edits or splitting, save a complete `.hfdbackup` to Downloads. Verify the file exists, passes the app's inspect check, and restores records, PDFs, and practice tests to a separate disposable dataset. Confirm a failed replacement does not destroy a prior valid backup.
7. Check update-over-existing-data, Finder and open/save panels, first-launch instructions, and the unchanged app-owned data path. Repeat the relevant document and backup checks on Windows if an installed Windows test machine is available.

**Current result:** Not run on an installed Mac in this Windows-hosted session. Do not describe this gate as passed from CI evidence alone.

## The final tag step

After the installed-Mac gate passes, verify the tested commit is still the current `main` head. In GitHub, choose **Actions → Release → Run workflow** on `main`, enter `0.5.2`, and run it. This single action creates `v0.5.2`, builds both installers, and publishes the release. Alternatively, from a clean clone with the same current `main` head:

```bash
git fetch origin main --tags
git tag -a v0.5.2 origin/main -m "Her Flight Deck 0.5.2"
git push origin v0.5.2
```

Pushing the tag immediately starts the publishing workflow. It rejects a tag that differs from current `main` or the repository's version files. Do not move the old `v0.5.1` tag, rebuild its release, or tag a different commit without repeating validation.
