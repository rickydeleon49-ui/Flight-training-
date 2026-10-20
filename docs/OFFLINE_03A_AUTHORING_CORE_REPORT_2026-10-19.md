# OFFLINE-03a, first implementation: authoring rules — 19 October 2026

## Scope

The owner requested review/merge of PRs #234 and #235, followed by continued implementation. Work started from accepted PR #234 (`4ff7c9d`), then integrated accepted PR #235 (`fc3ef34`) before the final full frontend gate, in `/Users/rickymac/code/Flight-training-offline-03a`, branch `codex/offline-03a-authoring-core`. The five OFFLINE-03 defaults remain approved.

03a spans two persistence engines, migration/restore validation, three card-fingerprint implementations and the editing screens. This first coherent implementation isolates the authoring rules and edit preparation before that coupled storage/UI work. **It does not implement the finished manual editor, migration 0016 or database history.** It is not imported by the app, does not alter current saves, and requires review before integration.

## What is implemented

`src/logic/studyAuthoring.ts` provides:
- **Stable item identities:** summary uses material-scoped `summary`; sections/cards retain existing IDs or receive IDs from the app’s secure UUID helper on the authoring path. Collisions are refused. A correction receives a fresh identity, except the material-scoped summary whose `replaces` refers to the summary in the prior logical version.
- **Immutable edit preparation:** add/edit/delete/correct returns both previous and proposed next logical states without modifying caller data. Ordinary edits keep the identity and source page; corrections replace the active original and record its identity; deleted/rewritten wording is retired. Even an ordinary text rewrite retires prior wording so regeneration cannot quietly place it beside her edit. Provenance-only edits do not grow the ledger. No writes occur, so a failed/abandoned plan leaves the caller’s state untouched.
- **Retirement records:** SHA-256 over JSON-framed normalized textual fields; NFKC, locale-independent lowercasing and collapsed whitespace. Separate fields remain unambiguous with embedded NUL/newline content. Records retain at most 64 sorted distinct Unicode word tokens, ordered by Unicode scalar values rather than locale. The full original text remains in the edit plan’s previous state; eventual storage must preserve the full original set and metadata in history.
- **All-or-refuse capacity:** deduplicate `(kind, itemId, reason, textKey)`; exactly 2,000 records is valid; a new 2,001st record refuses the plan without eviction or caller mutation. Contradictory term metadata for one record and malformed ledger metadata are refused.
- **Regeneration review:** same-kind exact repeats are held back by default; word-set Jaccard ≥0.6 is unresolved and requires an explicit keep/omit choice; unrelated candidates are new. Both sides use the same capped term representation. Only the strongest matching record is returned per candidate, avoiding an enormous match list; ties are deterministic. Explicit keep can bring a held item back. Unknown preview IDs/choices are refused. Candidates are copied before asynchronous hashing so later caller edits cannot change a preview in flight.
- **Origin/export policy:** manual/user items say User-created, instructor items say Instructor correction; neither falls through to Gemini. Unknown provenance refuses. Instructor items are excluded from export selection unless explicitly included. This is selection policy, not new export UI or packet serialization.

## Implementation details that the next storage change must preserve

The view-model field order is `[summary]`, `[heading, body]`, `[front, back]`. Field bounds reuse the existing study-packet constants and source-page range. Draft fields are bounded by trimmed Unicode scalar count, the same measure as card review (`isValidCardText`, native `is_valid_card_text`) and import; no text is silently clipped. Empty summary is allowed; section fields and card sides must be nonblank. Existing invalid legacy content needs an explicit repair/refusal UI, not a mapper that silently drops it.

Retirement digest framing is `SHA256(UTF8(JSON.stringify(normalizedFields)))`. Normalization is per field before framing. It is a new retirement digest, **not** a change to card review hashes or saved-search digests. Independent Node crypto checks a fixed framed example. Native parity vectors are required before a native writer persists it.

This module accepts already structured in-process values. It is not a raw JSON/IPC parser, an authorization boundary, a complete saved-study-set serializer or a worker/resource proof. `sourcePage`, `origin` and `replaces` survive applicable logical edits. Full set title/model/provider/timestamps/source notes remain the persistence adapter’s responsibility and must be retained in its full history snapshot.

Near matching is approximate: different wording, terms outside the retained 64, another content kind or semantically different wording can evade or trigger it. UI must disclose this limitation and show a deliberate preview. It is not an aviation-correctness or semantic equivalence test. Performance/resource admission for actual large-set UI use is still to be measured; this core is not enabled in production.

## Verification

The focused authoring suite has **55 passing cases**: legacy IDs/collisions, malformed input and text/count boundaries, Unicode/field framing, retirement bounds, near/exact/new classifications, deterministic strongest match, stale/invalid choices, asynchronous input mutation, origin labels, privacy default, complete edit plans, source pages and refusal without state loss.

These are tests for newly introduced behavior, not a claimed pre-existing regression reproduction. No new dependency, lockfile, migration, native code or release flag changed. **Final sequential gate on accepted main plus the core: 3,835 frontend tests passed / 6 skipped, zero unhandled errors; typecheck, frontend build and whitespace all exit 0.** Complete output, exits and hashes are in `docs/evidence/offline-03a-authoring-core-2026-10-19/`. Native tests/benchmarks can be reused for unchanged native code; no installed acceptance is claimed.

## Independent review corrections (Claude, round 1)

Claude reviewed `750c90c` locally (55/55) and returned RED with one blocking and three minor findings; all four are corrected on `claude/offline-03a-core-fixes`:
1. **Instructor privacy:** an ordinary edit of an instructor correction must keep `origin: "instructor"`; an attempt to relabel it as hers is refused, so it cannot become exportable by default. Replacing it with her own item remains possible only through a deliberate correction.
2. **No relabel without change:** an edit whose fields are unchanged returns `next === previous`, so generated wording is never marked User-created and nothing should be saved.
3. **Ordinary rewrites are retired:** recorded as proposal revision 5 (§2.2), including the capacity consequence.
4. **Length measure:** fields are bounded by trimmed code points, matching card review and import, so a set the app accepts is not refused for editing.

Focused suite: **57 passing cases**. Non-blocking notes for the integration work: a 500-candidate preview against a full 2,000-entry ledger took about 1.3 s in Node on an Apple Silicon Mac, so measure it or move it off the main thread before wiring the UI; and the core does not detect regenerated candidates that duplicate an **active** item, which the Keep-my-items merge must handle.

## Still needed to complete 03a

1. Add and register migration 0016 exactly once, after checking the live numbering. Update browser/native schema/backup validators together; preserve shipped migrations/checksums.
2. Implement atomic save/restore/import/regeneration paths in browser and native repositories. Compare the entire expected prior set/revision inside the transaction (timestamps alone are insufficient). Write the **full** previous set plus provenance/retirement metadata before any mutation, in that same transaction. Reuse one prepared operation on uncertain retries; prove rollback and duplicate-click behavior.
3. Persist stable IDs and origins faithfully in every mapper; no unknown/manual provider may be coerced to Gemini. Preserve raw pre-edit text and metadata. Adapt this core’s logical states without losing source notes, page refs or other set metadata.
4. Extend card canonical origin handling in TypeScript, Rust and backup validation with independent shared vectors, retaining every legacy hash. Implement the origin side tables and audit every provider reader before storing manual sets.
5. Build create/edit/previous-version screens, draft recovery, the Keep my items default and the complete regeneration/import preview. Merge manually authored current items with the resolved candidates; handle the one-summary choice explicitly and never silently replace it. An abandoned preview writes nothing. Bind a saved decision to the actual current set/candidate content and recheck it at commit.
6. Wire origin labels and export filtering, v1 label-loss disclosure, default exclusion of instructor corrections and deliberately included handout labels. Do not pass extra v1 fields through its strict validator.
7. Run both-engine rollback/restore and editor tests before claiming 03a complete. Only after reviewed integration proceed to 03b manual practice questions. 03c remains deferred.

Do not expose a partially wired editor or start writing manual/origin-bearing data while old readers/hash implementations still drop that metadata. No native application, real profile/key, provider, installer, signing or release action is part of this implementation.
