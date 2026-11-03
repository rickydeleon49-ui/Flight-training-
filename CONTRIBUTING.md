# Contributing

Thanks for helping. Bug reports, small fixes and clear suggestions are welcome.

- **Bugs:** open an issue with the bug report template. Never attach real
  training records, API keys or private documents.
- **Security problems:** see [SECURITY.md](SECURITY.md); do not file them publicly.
- **Changes:** open a pull request against `main`. Keep it small and focused,
  and keep the app simple for a student pilot.

Before opening a pull request, with Node 22:

```bash
npm ci
npm run typecheck
npm test
npm run hygiene
cargo test --locked --manifest-path src-tauri/Cargo.toml   # if you touched Rust
```

`CLAUDE.md` lists every check CI runs and the rules that protect user data:
migrations only add, the bundle identifier never changes, and no new
dependencies without discussion first.

By contributing you agree that your work is released under the MIT License.

## Sample profile for testing

With Node 22 and `npm ci` complete, run `node scripts/seed-sample-profile.mjs qa-student`.
This fills `~/Library/Application Support/com.herflightdeck.synthetic.qa-student/` with fictional study data.
Use that same synthetic identifier when launching your QA build; close its app before seeding.
Repeat runs preserve the sample; add `--reset` to rebuild only that synthetic profile.
Includes a PDF, guide, 12 rated cards (five due), picture card, finished test, oral scenario, journal and homework.
