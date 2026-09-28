# Release review process

The release workflow supports two execution modes:
1. **Private CI Artifacts (`create_draft: false`, default):** Compiles the target installer and uploads it as a private Actions artifact for preliminary testing. It does **not** create a git tag or a GitHub Release draft.
2. **Reviewable Release Candidate (`create_draft: true`):** A maintainer explicitly selects `create_draft: true` (or pushes a `v*` tag) to create the immutable tag (`v<version>`) and an unpublished GitHub Release draft. Draft installers are strictly for owner review and physical hardware testing, and are not a public release.

## Platform Distribution Status and Release Pathways

Under current release policy ([`scripts/release-policy.json`](../scripts/release-policy.json)):
- **macOS (Apple Silicon):** Active candidate pathway (`v0.5.3`). Mac releases proceed under an independent physical installed-device verification gate on Apple Silicon hardware.
- **Windows:** Distribution remains **HELD on v0.5.1** pending separate Microsoft Defender clearance of a future candidate. Unreviewed Windows binaries must not be attached or distributed. Selecting target `all` in the release workflow is rejected by policy unless Windows is explicitly marked `active`.
- *(Historical note: Initial releases targeted simultaneous Windows and Mac distribution; the Windows hold began with v0.5.2 detection and is maintained independently so Mac users receive vetted updates.)*

---

## The Exact-Installer Invariant

**The exact bytes published must be the exact bytes tested on physical hardware.**
- A test performed on a preliminary CI artifact does **not** authorize distributing newly built bytes from a subsequent workflow run.
- When a GitHub Release draft is created with `create_draft: true`, download the **exact draft assets** attached to that draft and verify their checksums against `SHA256SUMS.txt`.
- Testing must be performed on the exact draft asset that will be made public upon draft publication.

---

## Review and Verification Sequence

Before publishing any draft:

1. **Verify Draft Assets and Checksums:**
   - Download the draft installers and `SHA256SUMS.txt` attached to the GitHub Release draft.
   - On macOS, verify the checksums using the native command:
     ```bash
     shasum -a 256 -c SHA256SUMS.txt
     ```
   - On Linux systems:
     ```bash
     sha256sum -c SHA256SUMS.txt
     ```
   - Confirm that the downloaded assets match the draft manifest exactly before installing.

2. **Apple Silicon Mac Installed-App Gate (Mandatory for macOS release):**
   - On physical Apple Silicon hardware (M1/M2/M3/M4), install the **exact `.dmg`** downloaded from the draft.
   - Execute the smoke test sequence: launch from `/Applications`, verify Gatekeeper prompt (record exact dialog text/buttons; never advise "Open Anyway" or `xattr -d`), import a PDF, open in Preview, reveal in Finder, execute automatic and manual splitting, test Gemini assistant, save complete backup to Downloads, and verify restore.
   - Record the release evidence:
     - Exact draft DMG filename and full 64-character SHA-256 hash.
     - GitHub Actions workflow run URL and ID that compiled the draft.
     - Git commit SHA at HEAD.
     - Mac hardware model, chip, RAM, and macOS version.
     - Tester name, date, and test outcome.

3. **Windows Gate (Applicable only when Windows distribution is active):**
   - If a dual-platform release is authorized in policy (`windows.status == "active"`):
     - Verify Microsoft Defender does not detect the exact draft `.exe`.
     - The Windows hold may be resolved either by authoritative Microsoft clearance of the exact installer or by trusted code signing.
     - If Defender reports a threat, hold the draft private and submit that exact file to Microsoft Security Intelligence. Do not tell a user to bypass Defender.
     - Verify the installed application on physical Windows hardware before distribution.
   - While Windows distribution is held, no Windows binary may be included in the draft.

4. **Release Notes and Version Verification:**
   - Confirm the draft title and release notes name the exact tested version.
   - Confirm that release notes for Mac-only drafts explicitly state that Windows distribution remains on `v0.5.1`.

5. **Publication Gate:**
   - Publish the draft **only** after all applicable platform gates for that draft pass.
   - **No-Retag Rule:** If any check fails on the draft, do **not** overwrite, delete, or repoint the git tag. Discard the draft, mark the version permanently retired in `scripts/release-policy.json` with the failure reason, fix the issue in source code, and advance to the next version (e.g. `0.5.4`).

Keep the release draft private until physical device testing is complete and approved. A successful CI build proves the package was built; it does not prove that macOS Gatekeeper or Windows Defender accepts the installed application.
