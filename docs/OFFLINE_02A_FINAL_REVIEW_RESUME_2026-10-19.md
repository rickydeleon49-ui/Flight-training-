# Resume after owner pause: independent review of OFFLINE-02a

**Paused at the owner's request. Do not resume work until the owner asks.**

When resumed, review `codex/offline-02a-completion` in `/Users/rickymac/code/Flight-training-offline-01`. Start with:

1. `docs/OFFLINE_02A_SELF_REVIEW_AND_PAUSE_2026-10-19.md` — latest source, fixes, tests and ownership disclosure.
2. `docs/OFFLINE_02A_BUDGET_OWNER_DECISION_2026-10-19.md` — exact approval: cold 10k ≤750 ms; index storage ≤3× canonical text. Keep all other limits. The proposed 3-second 30k limit was not adopted.
3. `docs/evidence/offline-02a-self-review-2026-10-19/README.md`, manifests and raw receipts — verify hashes before any edit.
4. The accepted rev6 design and the original completion report/evidence — preserved history, original frozen workload/targets and original failures. Do not overwrite them or treat their superseded performance blockers as current without reading the owner decision.

Codex wrote the completion and corrections. Your source review must be independent. No prior self-review constitutes acceptance, and no PR or merge is implied.

Check the actual source, especially:

- `cache.rs`: full schema/trigger definition validation as well as corruption/recovery and once-per-file/process validation. Test both missing and no-op trigger corruption; preserve exact text, delete and snippet behavior.
- `service.rs`: hash/stamp bracketing, the deterministic after-hash race regression and confinement of scheduling hooks to test builds.
- `search.rs` and `search_api.rs`: background initialization, pending/failure errors, cache replacement and retry; no partially validated SQL or work on the extraction executor. Check request ownership, one running/one waiting, strict 2-second search deadlines, repeated interruption, both startup races, response bytes and snapshot consistency.
- Native composition and measurement adapters: actual PDF → real worker → cache → native search/destination proof. Benchmark page JSON is a disclosed fixture, not an installed PDF. The first-query adapter includes initialization wait; it must not hide it in discarded warm-ups.
- Default-release refusal, dev-only `functions`, unchanged dependency graphs/lockfiles, schema 15/migrations and inactive release flags.

Reuse the unchanged frontend/full gate evidence. For native corrections, run focused extraction/service tests and strict Clippy/fmt; expand only where failures or changed behavior warrant it. Frozen benchmark seed/queries/filters/sample counts and the original files stay fixed. Record original and amended budget verdicts separately. Do not rerun memory pressure, launch an app, access profiles/keys, call providers, build installers or enable releases.

Return independent acceptance or one precise consolidated correction report with source locations, triggering cases, impact and exact required regressions. Update trackers while preserving history. After acceptance, use the normal PR/exact-head CI workflow; no merge without its gate. OFFLINE-02b starts only after accepted integration. User priority remains offline study → homework → exports.
