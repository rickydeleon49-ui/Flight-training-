# [WITHDRAWN HISTORICAL RECORD] Her Flight Deck 0.5.2 — release preparation

> [!WARNING]
> **WITHDRAWN AND RETIRED RELEASE:** Version `0.5.2` was prepared, briefly tagged on 14 September 2026, and immediately withdrawn following an unresolved Microsoft Defender detection (`Trojan:Win32/Wacatac.B!ml`) on the Windows installer.
> Per repository engineering rules and `scripts/release-policy.json`, version `0.5.2` is **permanently retired and must never be reused, re-tagged, rebuilt, or published**.
> The next release will be `0.5.3` or later, prepared only after all vendor disputes, code signing, and platform verification gates are resolved.
> Actionable tag and publishing commands in this document have been permanently disabled. This file is retained solely for historical audit evidence.

---

## Historical Context

- `v0.5.1` remains the latest distributable release.
- The preparation below was performed prior to the withdrawal. The code changes from this cycle remain in `main`, but will be released under `0.5.3` or later.

## What was prepared

- `package.json`, both root package-lock versions, `src-tauri/Cargo.toml`, the app package in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` recorded `0.5.2`.
- The bundle identifier remains `com.herflightdeck.app`, and shipped migrations and backup formats are unchanged.
- `docs/releases/v0.5.2.md` holds the historical change summary for reference.

## Automated evidence (Historical)

On the Windows x64 development host, `npm ci` reported zero vulnerabilities; `npm test` passed 337 tests (two manual benchmarks skipped); `npm run build` passed; `cargo fmt --check`, strict Clippy, and `cargo test` passed 88 Rust tests (two intentionally ignored benchmarks). `npm run tauri build -- --bundles nsis` produced `Her Flight Deck_0.5.2_x64-setup.exe` (3,643,726 bytes, SHA-256 `2B934CF58520FE748E67EEA9D1FE8DE6A7E98171098A16AD677A7E2FA6174E65`). The hosted Apple Silicon 0.5.2 package check is recorded in the release-preparation PR. The same code before this version-only preparation passed [main CI](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/34776515488) and an [Apple Silicon build](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/34808668123).

## Installed Mac release gate checklist (Reference for future releases)

Use an Apple Silicon Mac running macOS 12 or newer and a copy of non-sensitive test data:

1. Install the candidate DMG to Applications and inspect Gatekeeper / system behavior. Do not bypass or disable platform security controls. Confirm the app opens cleanly and retains the existing library when installed over the previous version.
2. Import a public PDF, move or delete the original upload, then open the managed copy in Preview. Use **Show in Finder** and Settings **Open folder**; confirm both reveal the paths shown by the app.
3. Automatically split a long or image-heavy PDF. Confirm responsive progress, no database-lock alert, original unchanged, every labeled part at most 50 MiB and 1,000 pages, a separate library record, and a study-guide action. Try a failure and confirm no orphan file or record.
4. Manually split a page range with and without a title. Check invalid range and oversized-output messages, the safety copy, and failure cleanup.
5. With a test Gemini key and public PDF, create a study guide, flashcards, and practice test. Check busy/429 messaging if it occurs. Confirm the key is absent from logs and backups. Settings still accepts the key in a webview password field; the stricter native-entry limitation remains documented in `MAC_AUDIT_2026-09-12.md`.
6. During ordinary edits or splitting, save a complete `.hfdbackup` to Downloads. Verify the file exists, passes the app's inspect check, and restores records, PDFs, and practice tests to a separate disposable dataset. Confirm a failed replacement does not destroy a prior valid backup.
7. Check update-over-existing-data, Finder and open/save panels, first-launch instructions, and the unchanged app-owned data path. Repeat the relevant document and backup checks on Windows if an installed Windows test machine is available.

---

## Actionable Tagging Disabled

> [!CAUTION]
> **DO NOT RUN OR EXECUTE:**
> Any attempt to tag `v0.5.2` or run the release workflow with `0.5.2` will be blocked by `scripts/check-release-version.mjs`.
> The former release commands below are disabled:
>
> ```text
> [DISABLED] Actions -> Release -> Run workflow (0.5.2 is rejected by release policy)
> [DISABLED] git tag -a v0.5.2 origin/main -m "Her Flight Deck 0.5.2"
> [DISABLED] git push origin v0.5.2
> ```
