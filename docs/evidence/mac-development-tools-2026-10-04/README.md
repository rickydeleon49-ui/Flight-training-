# Mac development tools setup evidence — 4 October 2026

`setup-results.json` records observed installed versions and checks. `cargo-deny-advisories.txt` preserves the actual first locked Mac-target advisory scan, with the direct `EXIT=1` marker. Six diagnostics are **unmaintained dependency advisories**, not vulnerability diagnostics. This scan used the tool's default config because the project has no deny policy yet; it is not a comprehensive security or license acceptance.

Playwright verification used an isolated synthetic blank browser page and closed its named session. Context7 was added to Claude's user configuration and reported Connected; no key was inserted into chat or Git. GitHub login was verified. The WebdriverIO CLI and Tauri service were installed globally and their commands/module import verified; no app-side plugins, instrumentation or native test config were added. Neither dirty app checkout was edited. No real app/profile, provider, installed test, signing, installer or release was executed.

For Git publication only, trailing spaces/tabs were removed from receipt lines. The task-owned raw receipt remains outside the repository. Both byte sizes and SHA-256 values, plus this transformation, are recorded in `setup-results.json`; advisory text, classifications and the direct exit marker are retained.
