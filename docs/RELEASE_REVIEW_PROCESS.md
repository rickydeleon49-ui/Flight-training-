# Release review process

Every release workflow run creates a GitHub **draft**. Draft installers are for
the owner to review and are not a public release.

Before publishing a draft:

1. Download the exact draft assets and compare them with `SHA256SUMS.txt`.
2. On Windows, verify Microsoft Defender does not detect the exact `.exe`.
   The Windows hold may be resolved either by authoritative Microsoft clearance
   of the exact installer or by trusted code signing. Paid code signing is the
   long-term path, but is not mandatory if Microsoft clears the exact binary.
   If Defender reports a threat, hold the draft private and submit that exact file
   to Microsoft Security Intelligence. Do not tell a user to bypass Defender.
   Verify the installed application on physical Windows hardware before distribution.
3. On an Apple silicon Mac, install the exact `.dmg` on physical Apple silicon
   hardware, import a PDF, open it, reveal the app folder, create and restore
   a backup, and verify the app launches normally. Physical installed-app
   validation is mandatory before distribution.
4. Confirm the release notes name the tested version and assets.
5. Publish the draft only after all applicable gates pass: the Windows hold is
   resolved by authoritative Microsoft clearance of the exact binary or by
   trusted code signing, and physical installed-app validation on both Windows
   and Apple Silicon hardware succeeds. If any check fails, fix the problem and
   prepare a new version; do not overwrite a published tag.

Keep the release draft private while any vendor review is pending. A successful
CI build proves the package was built; it does not prove that Windows Defender
or macOS accepts the installed application.
