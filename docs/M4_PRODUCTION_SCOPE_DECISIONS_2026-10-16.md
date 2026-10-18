# M4 production scope: owner decision packet — 16 October 2026

**Status: all ten recommended defaults APPROVED by the owner on16 October2026; see [the approval record](M4_PRODUCTION_SCOPE_OWNER_APPROVAL_2026-10-16.md).** The evidence-only prototype passed independent review. These decisions make the next real application change concrete. Approval of the prototype is separate from approval of this scope or a release.

| Decision | Recommended production default |
| --- | --- |
| OD-1 — delivery | First add source links, bookmarks and last-requested page tracking. Evaluate an embedded viewer separately later. |
| OD-2 — reader | Keep opening PDFs in the Mac's default reader (and existing Windows reader). Show clear page guidance; do not promise automatic native page jumps without proof. |
| OD-3 — Mac support | Keep the current macOS12 minimum. Do not raise it for a viewer package; physical old-Mac verification remains separate. |
| OD-4 — page numbers | Store safe, positive whole-number physical PDF pages, bounded by a trusted page count. |
| OD-5 — printed labels | Keep printed labels such as iv or3-12 separate from physical PDF page numbers; resolve them only through a content-matched verified mapping. |
| OD-6 — invalid references | **Recommended revision:** refuse an out-of-range or unverified reference and explain it. Do not silently jump to a different page. This preserves the tested reference behavior. |
| OD-7 — split documents | Translate to the correct live root/parent/child using saved lineage. If an ancestor is gone, give guidance instead of redirecting to the wrong document. |
| OD-8 — changed files | Bind saved navigation to the exact file hash; changed bytes or invalid bounds make old entries visibly unverified. Reconcile atomically. |
| OD-9 — reading meaning | Track the last requested page separately from an explicit read confirmation. Opening a page does not mean the document was read/completed; failures cannot advance saved progress. |
| OD-10 — backup/compatibility | Include all four navigation tables in backups/restores and deletion cascades. Preserve pre-upgrade safety copies. Older schema14 binaries must refuse a schema15 database; use the appropriate older backup to return to an older version. |

**OD-6 choice recorded: refuse and explain. Historical choice context:** the earlier evaluation proposed clamping an explicit page below/above bounds to the nearest valid page with a warning. The actual tested resolver rejects it. The recommendation above replaces that unapproved proposal with the measured, safer refusal behavior. If the owner chooses clamping instead, specify that as a deliberate behavior change and add its own tests; do not weaken existing resolution guards silently.

Production scope excludes new PDF rendering packages, OCR, annotations, semantic/vector search, automatic uploads, new provider calls, signing and release publication. The existing preview/opening route stays available. The embedded-viewer candidate remains an evaluation artifact, not a production dependency.

**Approval record:** [direct owner confirmation](M4_PRODUCTION_SCOPE_OWNER_APPROVAL_2026-10-16.md), all ten defaults including OD-6. This authorizes bounded Slice1 source work. A release/version decision is handled through the existing release process, not implied by this packet.

Current implementation handoff: [M4_SLICE1_CURRENT_HANDOFF_2026-10-16.md](M4_SLICE1_CURRENT_HANDOFF_2026-10-16.md). Acceptance: [M4_ROUND6_ACCEPTANCE_2026-10-16.md](M4_ROUND6_ACCEPTANCE_2026-10-16.md).
