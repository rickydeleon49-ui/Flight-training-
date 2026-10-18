# Study Library file-bar overlap: implementation for review

**Implemented, pending independent review; no merge.** Owner screenshot shows the file metadata obscured by Split automatically / Take out a chapter / Open. Based on accepted main `2fc27b90aacd33183a8e5c0f3047008df37383b4`.

## Cause and change

`MaterialDetail.tsx` put its icon, flexible metadata and three non-wrapping buttons into one non-wrapping `.file-row`. At constrained widths the metadata could shrink to almost nothing while the controls exceeded available space.

The detail bar now has explicit metadata and action groups. Metadata keeps a useful preferred width, and actions take their own wrapping row. Narrow controls may wrap labels, with bounded horizontal padding and a non-shrinking Open icon; empty action groups are hidden. Filename truncation remains within the metadata group and the file size stays readable. The separate material-form file row is unchanged. All action conditions and handlers are unchanged.

## Verification

- A disposable layout probe renders the **actual file-bar JSX extracted from MaterialDetail**, actual Button/Icons and production CSS/self-hosted Inter fonts. It uses synthetic data in a temporary headless Chrome context, blocks network access and never loads the app database/profile.
- Widths320/480/640/960 × text sizes100/150/200% × PDF/missing/other file states: **before22/36 pass (14 failures); after36/36 pass**. Measures metadata usability, file-size bounds, action overlap and horizontal overflow. Screenshots were visually inspected at640px and320px/200% text.
- Existing SplitLineage component suite: **9 passed**, exit0. Typecheck: exit0. These were run after the JSX change; subsequent adjustments affect only scoped CSS.
- Final production web build passes (exit0), with its raw receipt in the evidence directory; it includes typecheck. No native code changed and no Rust matrix was repeated.
- Helper26/26 passes; bindings and checksum checks are refreshed for the current tracker additions. Historical receipts are preserved.

The packaged Playwright browsers were absent, so the probe used already-installed Google Chrome with a disposable profile. No browser or package was downloaded.

## Review boundaries

This is a source/browser-layout fix, not an installed-app observation. Playwright Chromium is not WKWebView; native Mac rendering, VoiceOver and the complete application interaction remain unverified. The probe checks this isolated production file bar, not every surrounding app layout. No app launch, owner data, credential, provider, installer, version or release operation occurred. The installed app will retain the old layout until a reviewed build includes this change.

[Evidence and reproduction](evidence/study-file-row-layout-2026-10-17/README.md). Review only the two source paths and their relevant effects. No merge is authorized.
