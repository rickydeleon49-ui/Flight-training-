# M2 Card Reviews C2 — Bounded-read corrections re-review (7 October 2026)

**Corrections required; C2 scope is not accepted yet.** All previously frozen cases pass. Preserve those fixes and finish the remaining resource, cursor and historical-state contracts in [one precise model-neutral assignment](M2_CARD_REVIEW_C2_CONTRACT_FINISH_PROMPT_2026-10-07.md). C2-D1–D9 stay proposed; C1 remains accepted.

Reviewed implementation branch `codex/m2-card-review-c2-scope` at `9028675475616ce338253ae7e4e46ba6b840b72c` in an isolated worktree based on main `280dd24b263e57324e282169d31c842122f2a9a5`. **40 submitted source hashes and 36 evidence checksums verify.** The implementation clone remains untouched; all six submitted evidence packs are preserved byte-for-byte. [Frozen snapshot and receipts](evidence/m2-card-review-c2-bounds-rereview-2026-10-07/README.md).

## Independently verified progress

- Five frozen diagnostics pass unchanged: **9 + 12 + 16 + 11 + 8 = 56**, exit 0.
- Submitted proof: **40/40**, exit 0, from repository root using Node 22 and `--experimental-strip-types`.
- Mutation baseline passes; four mutants fail through assertions; survival control rejects an assertion-disabled survivor.
- Malformed-prefix bytes are now counted and bounded in the previously failing discovery/pending examples. The 500-card exact-boundary overread is fixed. The 250-UUID generated cursor is consumable under the new 32-KiB cap; missing version and missing history keys are rejected.
- Typed nullable inspection fields and raw audit strings have been added. The genuinely max-length Unicode fixture is production-valid. Preserve these improvements.
- Independent SQL audit: due first/continuation/filter **218 / 150 / 216 calls**; history first/continuation/filter **22 / 22 / 22**. These are per-set raw reads with metadata/state batching, not the old two-call history implementation. Counts do not themselves prove a latency regression.
- New focused diagnostic: **one control pass / ten assertion failures**, exit 1, across the remaining contract gaps below. No full app/native/Xcode suites were rerun for unchanged production code.

## C2-R4 continued — oversize content disappears and card work still exceeds budget

Source: `docs/evidence/m2-card-review-c2-bounded-read-corrections-2026-10-07/proof/contractModel.mjs`.

**Silent oversize loss:** discovery lines 689–694 advance past a set above 8 MiB without returning a typed issue, material link or error. Pending lines 477–479 consume its identity and break. A single such material produces zero rows, null cursor and complete/caught-up state. The handoff claims `PAYLOAD_TOO_LARGE`, but that error is not implemented.

This affects production-valid C1 content, not only malformed junk: 500 cards with U+0001 repeated 1000/2000 times on their sides validate under the existing C1 parser; JSON escaping yields **9,020,501 bytes**, above the proposed **8,388,608** cap. A bound is appropriate, but it must expose an explicit blocked/deferred material, not classify it as absent or caught up. The submitted “giant payload” test currently enshrines zero rows/null cursor and needs correction with disclosure.

**History bypasses the absolute cap:** its first distinct material is fetched unconditionally (around lines 950–958); the same legitimate fixture transfers **9,020,501 bytes**. The history path never checks `ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES`. Apply the bounded oversize policy consistently before transfer, including first-set admission.

**Mixed-size card overwork:** discovery lines 679–685 stop only once the accumulated count has already reached the limit; lines 711–725 parse the next set before deciding it will not fit. Pending lines 468–474 / 493–505 have the same problem. Under a **600-card** budget, **400 + 500 = 900 cards** are transferred/parsed in both paths, while `evaluatedCards` reports only **400**. Counters now count the bytes, but admission still fails to bound parse work. Reserve a demonstrated conservative allowance before raw fetch/parse and separate parsed/reserved/derived work from returned rows.

History now honestly marks unread current sets `pending` with unknown provenance. However, the scope/conditional API gives no concrete read-only action or enrichment continuation that completes those pending rows. A final event page can have `next: null` and unresolved provenance. Define and prove a bounded targeted retry or enrichment continuation; event pagination completion must not imply enrichment completion. Do not keep refetching the same first set and starving later ones.

Frozen new cases 1–5 fail on oversize loss, history cap and mixed-size parsing. Pending-enrichment completion is a supporting contract requirement, not counted as a separate frozen failure.

## C2-R8 continued — validation still admits restarted/duplicate streams

Due validation checks version/kind/context/remIds element lengths, but omits complete candidate key shape (`lc`, `lp`, `lu`), boolean exhaustion and pending-ID uniqueness. A v1 owned-context token with `remIds: []`, `isExhausted: false` and no candidate key silently restarts page 1. An owned token containing `['a','a']` can emit duplicate material rows. Reject both before SQL.

History checks `Date.parse(t)` and nonempty `id`, but not canonical time or its claimed 64-character ID bound. **`2026-02-30T00:00:00.000Z`** passes Date.parse through normalization; an ID of 65 characters is also accepted. C1 already exports `isIsoInstant`, which checks exact round-trip canonical UTC form. Finish kind-specific bounded field/context validation and query input normalization, retaining compatible page-size changes. New cases 6–8 demonstrate these unfinished requirements.

## C2-R10 inspection continued — unsupported states receive invented supported intervals

`validateScheduleState` (around lines 128–203) defaults an absent `schedulerVersion` to `simple-v1`, accepts normalized-invalid calendar dates and admits negative integer repetition/lapse counts. History calls it without the actual event scheduler context (around lines 1016–1017).

An event recorded under **`unsupported-v99`** with a versionless state `{step: 0, dueAt: <valid timestamp>, reps: 1, lapses: 0}` is displayed with **`intervalLabel: '1d'`** and a validated simple-v1 schedule. This violates the stated unsupported-state fallback. Use verified event/state scheduler ownership; infer supported legacy metadata only from an explicitly supported event context. Reuse C1 canonical date/ladder helpers, validate optional count values, preserve raw audit strings, and leave unsupported/invalid schedule and interval fields null. New cases 9–10 fail; the supported 16-day control passes.

## Supporting documentation/evidence

- Benchmark §4 still labels its independently duplicated, uncapped candidate loop as actual pipeline instrumentation. It computes size metadata but does not enforce admission in that loop. Remove the duplicate component measurements or label them approximate; retain correctly labelled full-reader timings.
- Conditional prompt still instructs one batched history raw read despite the now-bounded per-set implementation. Update actual resource counters, history pending resolution, explicit oversize output and cursor schema. Repository-relative links beginning `docs/` inside a file already under `docs/` resolve to nonexistent `docs/docs/...`; correct those links.
- Worst-case arithmetic must include JSON escaping, not only UTF-8 code-point width. The max Unicode fixture is useful, but the demonstrated valid escaped fixture exceeds 8 MiB. Raw storage can also include whitespace; serialization examples cannot substitute for an explicit raw-read cap.

These finish existing requested contracts. The [next assignment](M2_CARD_REVIEW_C2_CONTRACT_FINISH_PROMPT_2026-10-07.md) provides implementation steps, test mappings and bounded gates. No production, migration, installed, signing, release or new roadmap work is activated.
