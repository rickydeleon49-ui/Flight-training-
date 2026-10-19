# GEN-REL-05 implementation report — 19 October 2026

**BLOCKED / INCOMPLETE. Do not integrate this as GEN-REL-05.**

Base: `3d50a64976da1c4ab5afca72edaa73f02802d4a6`. All changes are uncommitted in the assigned worktree. No commit, push, merge, dependency, migration or version change. The protected coordinator files and schema-14 manifest are unchanged.

## Work completed: GENREL04-R12 source correction

`src-tauri/src/gemini_files.rs` now uses `PendingRetirements`, a drop guard owning only entries whose DELETE has not been dispatched. Each iteration checks the existing journal-backed admission before taking an entry. While its DELETE is pending, all later entries stay in the guard. Dropping the future returns those entries to the cache's `orphaned` queue. An admission refusal uses the same drop path. The already dispatched entry is not retried: its remote outcome is uncertain. Credential filtering, best-effort cleanup, lease ownership and per-DELETE admission are preserved.

`finish_admitted` delegates to `retire_admitted` without another suspension between taking the orphan queue and entering the guarded cleanup. Both paths therefore use the guard. The guard holds no cache lock across an await.

Named regressions in `src-tauri/src/gemini_files_tests.rs`:

- `r12_dropped_retire_returns_unsent_copies_to_orphaned`: cancel through `Cancellable` while the first loopback DELETE remains held; check the unsent copy is retained and a subsequent cleanup sends it once.
- `r12_dropped_finish_returns_unsent_copies_to_orphaned`: the same regression through `finish_admitted`.
- `r12_cancellable_drop_keeps_only_unsent_entries_without_transport`: socket-free check that cancellation drops the guard, returning the second and third entries while excluding the dispatched first entry. This supplements, rather than replaces, HTTP integration coverage.

## Blocking evidence and failure record

The first focused regression run (`r12-before.log`) failed at `FakeGemini::start`, `src-tauri/src/fake_gemini.rs:174`, with `PermissionDenied: Operation not permitted` from binding the loopback listener. Neither regression reached the cleanup code. This is an infrastructure failure, **not a demonstrated pre-fix product failure**. The permission profile does not allow escalation, so no attempt was made to bypass it. The required held-DELETE HTTP verification cannot be claimed green in this environment.

No live provider, key, private profile, app launch or external network request was used. Cargo was run with `CARGO_NET_OFFLINE=true`.

## GEN-REL-05 design work and request cap

GEN-REL-05 is **not implemented**. No target selector, batching engine, batch checkpoint format, persistent batch ledger, resume path or count display is included. Existing generation behavior remains unchanged. This package must not be represented as delivering larger card sets.

Source inspection identified two integration points that require explicit design and acceptance before the feature can be complete:

1. The existing journal keeps a final validated answer, but no distinct partial-batch draft. A batch draft must stay separate from a publishable `result`, preserve exact source/material/page identity and next-batch identity, and survive cancellation/restart without being forgotten by the frontend's failed-job acknowledgement path.
2. The existing shared budget counts every submission against three attempts. Planned guide/card-batch calls need separate accounting from recovery attempts; simply resetting that counter per batch would weaken the reviewed job bound. Elapsed time and submission reservations must persist across deliberate resume.

A prospective finite **generation-submission cap is 9**: one guide request, at most six card batches, plus at most two extra recovery submissions shared across the whole job, with no logical unit exceeding three attempts and one cumulative 300-second active budget. This is a design proposal only, **not an implemented policy or a claim that the existing three-total-attempt policy has changed**. Source preparation, polling and DELETEs retain their own existing bounds; nine is not a cap for every HTTP method combined. Any eventual implementation must declare and test the full bound including preparation/re-preparation and cleanup.

A completed set would be deliberately accepted through the existing version/replacement write contract; partial batches would never append into live cards or alter review progress. A response with fewer supported distinct cards would explain the shortfall, without padding. Exact normalized pair de-duplication would not be presented as proof of factual correctness.

## Acceptance map

| Requirement | Implementation / named tests |
| --- | --- |
| R12: cancellation drops cleanup during held first DELETE | Source fix and the two `r12_dropped_*` regressions above; HTTP execution blocked at listener bind |
| R12: drop returns unsent entries, excludes in-flight entry | `r12_cancellable_drop_keeps_only_unsent_entries_without_transport` |
| Targets 20/40/60, default 40, invalid targets; practice count unchanged | GEN-REL-05 not implemented; no new acceptance coverage |
| Batches up to 10; finite planned-call/retry accounting; shared 300 seconds | GEN-REL-05 not implemented; prospective design above only |
| Prepared PDF reuse; no inline PDF; source/material/content/page identity per batch | Existing code unchanged; no batch acceptance coverage |
| Short/empty source, quality/disclaimers, unsupported-source handling | Existing code unchanged; no batch acceptance coverage |
| Exact normalized cross-batch duplicates and repeated responses | Not implemented or tested |
| Changed source between batches; missing/bad page references | Not implemented or tested |
| Malformed/truncated output; token/byte limits per batch | Not implemented or tested |
| Draft checkpoints; budget/retry exhaustion; interrupted-batch idempotence | Not implemented or tested |
| Cancel/restart/resume; completed/target counts | Not implemented or tested for batching |
| Deliberate completed-set acceptance; failed save preserves prior content/history | Existing code unchanged; no new batch/final-save acceptance coverage |
| Captured upload bytes and bounded batch request counts | No GEN-REL-05 measurements: required HTTP fixtures cannot bind |

## Final gate

The final gate was invoked once with Node 22 on PATH, Cargo offline, and the requested SDKROOT scoped to Cargo. Raw command logs and exit codes are under `docs/evidence/gen-rel-05-2026-10-19/`; `gate-results.json` records individual outcomes. The schema helper's runner removes `src-tauri/target/flycheck0` before that check if present.

| Gate | Outcome |
| --- | --- |
| `npm run typecheck` | PASS, exit 0 |
| `npm test` | PASS, exit 0; 3,693 passed / 6 skipped |
| `npm run build` | PASS, exit 0 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | FAIL, exit 101; 575 passed / 95 failed / 6 ignored |
| strict Clippy, all targets | PASS, exit 0 |
| Cargo fmt check | PASS, exit 0 |
| `npm run test:cargo-lock` | PASS, exit 0 |
| schema-14 profile helper | FAIL, exit 1; 25 passed / 1 failed |
| `git diff --check` | PASS, exit 0 |

All 95 native failure blocks contain `Operation not permitted`; their panic locations and classification are captured in `failure-classification.json`. The socket-free R12 test passed in this full run. The HTTP R12 tests failed at listener setup, so their intended assertions remain UNVERIFIED.

The schema helper failure is `snapshot outside the approved lane refuses and writes nothing`: sandbox-denied process enumeration emits `sysmon request failed ... sysmond service not found` and `pgrep: Cannot get process list` before the expected `REFUSED:` prefix, failing its anchored output assertion. Its safety refusal still occurs. The helper and its manifest were not changed, the failure receipt is retained, and the check was not rerun.

## Limits and handoff

The source fix is offered for review, not acceptance. The HTTP cancellation regressions need a local test environment that permits synthetic loopback listeners. GEN-REL-05 remains outstanding, and its entire acceptance matrix must be implemented and verified before this task can be ready for review as a complete feature. No installed-Mac behavior, live-provider quality/duration, upload-byte measurement or complete batching flow is verified by this package.
