# P54-04 save corrections and independent review handoff

**Implemented by Codex; pending independent review. Do not self-merge.**

Worktree `/Users/rickymac/code/Flight-training-post-v054-roadmap`, branch `codex/study-export-save-recovery`, based on PR193 a490dac plus accepted main3266f193 (merge3046035). Claude's source worktree/branch is untouched. PR191 was independently reviewed and merged at3266f193 after green exact-head CI38991448773 and independent local3,284 frontend/build/helper checks. PR193 remains unaccepted; this correction targets its branch.

## Confirmed issues and fixes

- **P54-04-R1 — duplicate save dispatch.** Two Save events before React commits the working-state render call the native save twice. The permanent same-render test reproduces2 calls on submitted source. A synchronous ref now owns the intent before generating output or opening the dialog, with release in finally for success, cancellation, native failure and validation refusal. No retry sends an old payload implicitly.
- **P54-04-R2 — editable pending selection.** While a native save is pending, the dialog still allows changing guide/cards/questions, output type and answer-key options, so its displayed selection can differ from the already-dispatched bytes. Both choice fieldsets and the standalone answer-key input are now disabled for that interval. Cancellation returns usable controls.

Four new frontend cases cover both reproductions, an intentional retry after native rejection and a corrected selection after packet validation refusal. The earlier2-failure receipt is retained separately. Existing seven dialog cases and packet/handout/service tests are preserved.

## Native proof correction and coverage

The prior "failed rename" test makes the directory read-only before the temporary file is opened, so an ordinary non-root run actually tests open failure. Four new cases inject partial persistence failure, flush-phase failure, panic unwind and a real rename failure after complete temporary bytes exist. The same private `write_export_with` path performs all validation, temporary creation, rename and cleanup; only its private persistence callback is replaced by unit tests. Production still uses write_all followed by sync_all; the public command, limits, native path chooser and original cleanup guard are unchanged.

**Retracted suspicion:** the initial concern that the guard necessarily leaks on Windows was not established. [Rust documents default delete sharing](https://doc.rust-lang.org/std/os/windows/fs/trait.OpenOptionsExt.html#tymethod.share_mode). No speculative handle-owner rewrite remains. The native module now accurately states that forced process termination or OS refusal can leave a temporary file; it does not claim crash-proof cleanup. Failed persistence never publishes partial destination bytes. These tests ran on macOS, not Windows.

## Final verification

Sequential gate8/8 exit0 on Node22.23.3, Rust1.99.0, scoped SDK26.5:

- Full frontend3,320 passed /6 skipped; no unhandled errors reported.
- Web build/final typecheck pass.
- Native490 passed /6 ignored, including13 export cases.
- All-target strict Clippy, fmt, lock sync, schema14 helper26/26 and diff hygiene pass.

[Evidence](evidence/p54-04-save-recovery-2026-10-16/README.md) contains raw exits, failure receipts and three-path source identity. No installed save dialog, Safari/WebKit print, VoiceOver, provider or real-profile evidence is claimed. No version/schema/dependency/capability change.

## Next reviewer

Read `docs/P54_04_SAVE_REVIEWER_PROMPT_2026-10-16.md`. Independently inspect these three changed source/test paths, require the correction's exact-head CI, then integrate into PR193 if accepted. PR193 must be retargeted/reconciled with accepted main after PR191 and get current-base CI before normal merge. M4/#189 and correction#194 remain separate; no self-acceptance or self-merge by this implementer.
