# Owner decision: real-user check-in waived — 4 October 2026

The owner instructed Codex: “work done lets bypass the user check in and view the mac verification prompt”. This is an explicit owner exception to the requirement for a recorded M2 real-user study check-in. The check-in requirement is waived; no study session or user-test result is claimed to have occurred.

## Current source and next assignment

A2 is independently accepted in [the integration acceptance](A2_INTEGRATION_ACCEPTANCE_2026-10-04.md) and published through [PR #78](https://github.com/rickydeleon49-ui/Flight-training-/pull/78), merged at `558725158cd93d49f8f9114693f61b08a00ffe2f`. The required check passed on source head `8a69fa2d24c1919cdd05d5370381ef9ead83c45c` ([run 37230953310](https://github.com/rickydeleon49-ui/Flight-training-/actions/runs/37230953310)).

The next Mac assignment is [Claude's accepted-source verification prompt](CLAUDE_MAC_A2_ACCEPTED_SOURCE_VERIFICATION_PROMPT_2026-10-04.md): source/driver/native APFS verification against published accepted A2. This decision records the waiver and presents that assignment; it does not report execution of any Mac tests.

## Scope of the exception

- Agents must not ask again for the real-user check-in or treat missing check-in notes as a blocker. Earlier roadmap, preparation and gate-review statements requiring that check-in are historical where superseded by this decision.
- Separate scoped implementation approval and D1–D9 decisions for structured study-import Slice B are not supplied by this waiver. In particular, the D3 older-binary provenance and unverified downgrade/restore tradeoff still needs its recorded decision. No Slice B/C implementation is started by publishing this note.
- Dedicated standard test account, acceptable signing/artifact selection, installed macOS/VoiceOver observations, live provider authorization and release requirements remain separate. No installed evidence, Gatekeeper bypass, new installer, tag or release is authorized by the check-in waiver.
- Preserve the earlier dirty primary Mac checkout. Use the clean agreed integration checkout or an appropriate isolated verification branch, and leave verification corrections/evidence uncommitted for Codex review under the existing workflow.
