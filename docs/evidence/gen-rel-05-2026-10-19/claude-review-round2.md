# Claude review, round 2: GEN-REL-05 + GENREL04-R12 (uncommitted, base 3d50a64)

Each round-1 finding is closed:

- **GENREL05-R1 (blocking): closed.**
  - Unit 0 now sends a guide-only response schema, with `flashcards` removed from both properties and required.
  - Any guide `flashcards` are replaced with `[]` before typed deserialization, so unsolicited or malformed guide cards can neither fail the unit nor enter the set.
  - Regression: `guide_cards_are_discarded_without_extra_requests`. The pre-fix failure is kept in `round1-before-native-serial.log`.
- **GENREL05-R2: closed.**
  - The acceptance policy now lives in `GeminiJobs.tsx` and is keyed by job kind; the service wrapper no longer injects it.
  - Practice tests still auto-save (`GENREL05-R2 practice tests still auto-save`).
- **GENREL05-R3: closed.**
  - A persisted `remainingMillis` ceiling is reduced from the monotonic budget at each reservation and checkpoint.
  - Resume takes the smaller of that ceiling and the wall-clock deadline, and legacy drafts default to 300 s.
  - Regressions: `resumed_allowance_cannot_exceed_persisted_remaining_time` and `remaining_allowance_is_checkpointed_from_monotonic_time`.
- **GENREL05-R4: closed.**
  - The kept-draft notice uses `stack stack--3`, `ai-disclaimer` with `role=status`, and small buttons.

My own checks:

- **Schema-14 helper outside the sandbox: 26/26** (`claude-schema14-outside-sandbox.log`). Its sandbox result of 25/26 comes from process-list denial, not from this change.
- `git diff --check`: clean.
- Protected paths are unchanged: migrations, checksums, npm/Cargo manifests and locks, `tauri.conf.json`, STATUS/ROADMAP/handoff, and the schema-14 manifest.
- Exact-head CI will rerun the full gate.

No new findings.

VERDICT: GREEN
