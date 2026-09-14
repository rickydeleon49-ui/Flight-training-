# Release review process

Every release workflow run creates a GitHub **draft**. Draft installers are for
the owner to review and are not a public release.

Before publishing a draft:

1. Download the exact draft assets and compare them with `SHA256SUMS.txt`.
2. On Windows, verify Microsoft Defender does not detect the exact `.exe`.
   If Defender reports a threat, withdraw the draft and submit that exact file
   to Microsoft Security Intelligence. Do not tell a user to bypass Defender.
3. On an Apple silicon Mac, install the exact `.dmg`, import a PDF, open it,
   reveal the app folder, create and restore a backup, and verify the app
   launches normally.
4. Confirm the release notes name the tested version and assets.
5. Publish the draft only after all applicable checks pass. If any check fails,
   fix the problem and prepare a new version; do not overwrite a published tag.

Keep the release draft private while any vendor review is pending. A successful
CI build proves the package was built; it does not prove that Windows Defender
or macOS accepts the installed application.
