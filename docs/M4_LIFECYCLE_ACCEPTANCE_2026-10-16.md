# M4 lifecycle correction (R11–R12): independent source acceptance

**Accepted and merged into PR189** as PR194, merge 4f2aef82f36d6160ec4e1e8fb2d8443d463ae23a, using the exact-head guard on 35bd450c65151b464abb79b1d6a496ecec3bd196. A Claude Code reviewer session reviewed Codex's correction source. That session is separate from the Codex implementer and did not write the correction. PR189 itself is still pending its own current-base CI before it merges into main.

## Reviewed source

- `src/state/navigation/useDocumentNavigation.ts`: each committed material/repository/lifetime owns its own lease. Retired work returns before it allocates a read generation or dispatches a read, so it cannot start a stale read or take ownership from a valid pending read. An action started from a stale render closure is refused before it dispatches a write. Same-context follow-up reloads still run, and StrictMode replay creates a fresh lease, so an old read cannot publish.
- `src/pages/StudyLibrary/navigation/SourcePageBadge.tsx`: each click owns a unique `{controller, epoch}` ticket. A late success, error or null completion clears the marker only if it still holds that same ticket. On cleanup the badge aborts only its own still-working epoch. Replacing the controller, or changing the material or page, retires the request that the badge owns. Guidance writes no database state.
- **No defects found.** One non-blocking observation: if the repository swaps while a check is in flight, the panel can still show that check's leftover `checkNote`/`actionError`. Switching materials is safe because `MaterialDetail` remounts on `key={materialId}`.

## Independent evidence (local, Node 22.23.3)

- **Manifests:** evidence `SHA256SUMS` 0 failures; `source-hashes.json` 4/4 files match committed bytes.
- **Navigation tests:** 5 files, 94/94 pass.
- **Frozen review tests:** `[R11]`/`[R12]` copied verbatim beside the source, 4/4 pass; on c234005 the same tests had 3 failures. The copied files were removed afterwards.
- **Typecheck:** pass.
- **Full frontend suite:** 3,488 pass / 6 skipped.
- **Node 26 run:** under the machine's default Node 26.10.0 the full suite reports 178 environmental failures (`localStorage` unavailable, `sqlite_master` writes refused). These are runtime differences unrelated to this source; CI pins Node 22.
- **Not run fresh:** native Rust tests and strict Clippy. Native source is unchanged from c234005. Exact-head CI for 35bd450 was green.

Installed reader/IPC, old-macOS and VoiceOver behavior remain unverified by these source checks. No app launch, profile/key, provider, installer, signing or release operation occurred. Earlier failing receipts are retained unchanged.
