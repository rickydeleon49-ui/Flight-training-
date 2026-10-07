# Primary sources (retrieved 7 October 2026 UTC; see receipts/library-evidence.txt)

| Source | URL | What it established |
| --- | --- | --- |
| npm registry metadata | https://registry.npmjs.org/ts-fsrs | `latest` 5.4.2 (beta 6.0.0-beta.13); license MIT; no dependencies/peer/optional; `engines.node >=20`; ESM/CJS/UMD exports; integrity `sha512-z4qop4pzTcyTzuJ566d9EaX/4bZZzhYfeaPImfVr+xcYT65c5oBgFDijUhCE/D+C78eaolHIhKRZ04/RwF+v2g==`; shasum `7bd23da3d8a35368b813f4064eabe829a46f9901`; SLSA provenance attestation listed; published 2026-09-01T02:23:24Z |
| Published tarball | https://registry.npmjs.org/ts-fsrs/-/ts-fsrs-5.4.2.tgz | 150,324 bytes, 13 files; SHA-512 and SHA-1 recomputed locally and equal to the registry values; no install lifecycle scripts |
| Upstream repository | https://github.com/open-spaced-repetition/ts-fsrs | Package directory `packages/fsrs`; not archived; pushed 2026-10-07; GitHub release v5.4.2; repository license MIT |
| License text | `LICENSE` inside the tarball and repository root | "MIT License — Copyright (c) 2026 Open Spaced Repetition". Obligation: keep the copyright and permission notice in copies or substantial portions (a third-party notice if ever bundled) |
| Shipped implementation | `dist/index.mjs`, `dist/index.d.ts` inside the tarball | Defaults (retention 0.9, max 36,500 days, fuzz off, steps 1m/10m, relearning 10m, FSRS-6.0); seeded Alea fuzz; no network/storage/eval; clamp-then-order interval rule (max can be exceeded); `maximum_interval: 0` falls back to default; `reschedule` history API |

Not verified: the npm provenance attestation's signature chain; the 6.0 beta line; installed Tauri WebKit execution (only the esbuild Safari 15 target build and Node 22 execution were exercised).
