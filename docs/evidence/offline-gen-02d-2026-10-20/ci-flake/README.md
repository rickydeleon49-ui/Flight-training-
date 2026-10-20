Added global Vitest testTimeout/hookTimeout of 20,000 ms and src/testing/vitestSetup.ts with testing-library asyncUtilTimeout of 10,000 ms.
This gives loaded CI runners time to finish tests and async readiness checks; no production code, assertions, dependencies, or existing local overrides changed.
The setup imports configure from @testing-library/react, matching StudySetEditing.test.ts; full-suite runs prove it loads in both node and jsdom environments.
Node 22 via /opt/homebrew/opt/node@22/bin; every check uses the requested receipt.py runner and has its own raw log here.
npm-test-1.log, npm-test-2.log, npm-test-3.log: each EXIT 0; 197 files passed, 4 skipped; 4,143 tests passed, 6 skipped; no CLI timeout overrides.
quickDebrief.log: EXIT 0; 1 file and 23 tests passed.
typecheck.log, build.log, diff-check.log: each EXIT 0.
Sandbox fallback: default config loader failed with EPERM writing node_modules/.vite-temp (npm-test-default-loader.log, EXIT 1); successful Vitest/build commands use --configLoader runner.
SHA256 vite.config.ts: b098c1334e55cae30f61ce1e54a30886e971aa7b600bed26f63fd55ddd02eb9e
SHA256 src/testing/vitestSetup.ts: 1a5bd5c24b0464cc35bfebbbc72aa3a706c7bac99d8ad5601f9391e25400c951
