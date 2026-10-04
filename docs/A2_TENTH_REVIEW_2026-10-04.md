# A2 tenth independent review — 4 October 2026

**R13 is corrected and all owner-source focused checks pass. Application integration is blocked by a reproducible incompatibility with the newer Study Library fixture setup on current main.**

## Source identity and passing correction

The supplied handoff identifies Claude as the Windows implementer; Codex independently reviewed actual source and logs. Owner remains dirty/uncommitted on `fix/atomic-study-material-saves`, base/HEAD `533a8f50c2d0de74a75f5542022da3182f376ee9`. Current main inspected: `37ec9a1f99af61dc0ce89b672bb0a4b63d69ac51`. All 24 supplied hashes/sizes match. The git-listed isolated snapshot has 311 files (307 previous files plus four unignored evidence files); all 311 owner files remain unchanged after review. Most supplied .log files are ignored by the repository's generic rule; this publication explicitly includes only the reviewed sanitized evidence folder. Native/R9 remains unchanged from the previous reviewed source.

The R13 source delta is a module-private `lineCommentEnd` used by both ordinary token scanning and CREATE/TRIGGER lookahead. It returns the next LF or input length; CR remains comment content, and CR outside comments remains whitespace. Previous BOM, variable, identifier, decimal/table-role and ownership fixes remain intact.

| Independent Windows focused check | Result |
| --- | --- |
| Maintained driver file | 1,385 passed, including 780 new R13 cases |
| Contract / repository / form / integration / editor safety | 1 / 25 / 12 / 3 / 10 passed |
| Ninth / eighth / seventh / sixth / fifth / fourth / third diagnostics | 78 / 72 / 68 / 152 / 72 / 14 / 12 passed |
| Shared prepared package | 181 passed; all 57 conditional seam assertions reached |
| Combined owner-source rerun | **2,085 passed**, 14 files, no failures/skips, exit 0, 20.99 s |

Measured runtime: Node 24.16.0 / SQLite 3.53.0 / sql.js 1.14.2 / Vitest 4.1.11. The previous acknowledged-write-loss reproductions now pass on both development drivers. The [implementer evidence](evidence/a2-r13-line-comment-2026-10-04/README.md) also supplies actual pre-fix failures, fixed runs, a sensitivity control (426 new-case failures on the unfixed scanner) and all nine full-gate logs: frontend 1,998 passed/four skipped; Rust 283 passed/six ignored. Those logs were inspected, not represented as a fresh independent native/full-matrix execution. Their source identity agrees with the supplied manifest. Independent evidence is [here](evidence/a2-tenth-review-2026-10-04/README.md).

sql.js TEMP schema disappearing during write-time export/reopen is honestly recorded as an existing development-driver limitation; its two record tests are not trigger-firing controls. Node covers TEMP/TEMPORARY firing. No application flow here depends on TEMP triggers; this review does not assign a driver redesign for that property.

## R14 — P2: current main's fixture helper still opens public transactions

Location: `src/perf/studyLibraryFixture.ts:111`–145, especially the public BEGIN at line 120. This file arrived with newer Mac Study Library baseline work and is absent from the older owner checkout. Its own comment explicitly says to switch to a supported fixture path when A2 starts rejecting public transaction control.

Codex constructed a local integration snapshot from current main plus the intended A2 source delta. Two mechanical conflicts were resolved only for this probe: keep both `study_packet::pick_study_packet` and `documents::save_material_operation` registrations; retain current main's richer benchmark fixture/harness while applying A2's removal of its public transaction wrapper. The fixture helper itself was left unchanged. No production correction was implemented.

Focused command: `vitest run src/perf/studyLibraryScenarios.test.ts --reporter=verbose`. **Three passed / five failed**, eight tests, exit 1, 1.79 s. Every failed scenario reaches `seedFixtureMaterials` and receives the owner guard error at its public BEGIN. Failures cover exact answer-key rendering, expanded 1,000-card display and sensitivity to wrong final/intermediate IDs/counts. They are real regressions when the two accepted development tracks are combined; they do not invalidate the R13 lexical fix or prove a native app defect.

The first isolated-probe attempt collected no tests because a dependency junction could not be created under the initial permission context. After creating that junction with approval, the same focused check reached the five source failures above. Both outputs are retained and distinguished; missing-module startup is not counted as a code regression.

Do not fix this by reverting the Mac baseline, copying the owner's older complete benchmark over main, allowing public BEGIN/COMMIT, exporting a raw handle or removing/skipping answer-key tests. Adapt the deterministic fixture to the existing driver-owned atomic batch API and preserve metadata, dates, tags, answer key and measured/timed boundaries. Inspect every benchmark fixture caller and wrapper. The opt-in benchmark's main wrapper was adapted only in the local mechanical probe; the final integration must explicitly preserve that change as well.

## Publication validation

The 31 review/index/implementer-evidence files pass credential, conflict-marker, path, whitespace, link and JSON checks: 257 repository-relative links resolve and three JSON manifests/receipts parse. The unchanged-source release-safety suite passes 51 tests with one deliberate skip (3.15 s). This validates the documentation publication, not the failed application integration.

## Review disposition and handoff

The R1–R13 owner-source focused regressions are green, but **A2 overall is not accepted for merge** because the latest-main compatibility gate fails. The integrated full matrix was not started after this focused failure. The local 900-file integration candidate and its patch are preserved in Codex outputs; the coordinator's own temporary application changes were reverted after byte-for-byte preservation, and the owner's dirty tree was never modified. No A2 source was committed or pushed.

Use [the latest-main integration correction prompt](GEMINI_A2_LATEST_MAIN_INTEGRATION_PROMPT_2026-10-04.md). It asks for the fixture compatibility correction in an isolated current-main candidate, followed by focused and one complete sequential gate on that exact resulting tree. Mac A2 source verification follows only after accepted source is shared. M2 check-in/D1–D9/Slice B, installed account/signing/APFS/WKWebView and release holds remain separate; this review clears none of them.
