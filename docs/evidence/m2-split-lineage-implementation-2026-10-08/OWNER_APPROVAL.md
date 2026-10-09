# Split lineage: owner approval

- **Date:** 8 October 2026
- **Recorded by:** Claude (reviewer session)
- **Owner's reply, verbatim, given directly in the reviewer session:** "i approve SL-D1 through SL-D8"

This approves the eight defaults exactly as written in `docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md` §2 (round-5 text; scope document SHA-256 `6352f00992be94b4df2836240afe042395809a50811a32ec16d453c0819acd9b`), summarised for the owner in `OWNER_DECISIONS.md`:
- SL-D1: hashing of the exact bytes split, in the native worker
- SL-D2: dedicated `material_split_lineage` and `split_operation_log` tables, with the declared delete policies
- SL-D3: two-tier coordinates
- SL-D4: legacy rows stay unknown
- SL-D5: children and snapshots are kept when a parent is deleted
- SL-D6: migration 0013 and schema 13
- SL-D7: the MaterialDetail lineage view, using the native viewer with a copy-page fallback
- SL-D8: the listed exclusions

With the scope accepted (`M2_SPLIT_LINEAGE_SCOPE_ACCEPTANCE_2026-10-08.md`), production implementation starts under `M2_SPLIT_LINEAGE_IMPLEMENTATION_PROMPT_2026-10-08.md`.

**Not approved here:** release timing (the owner plans a Mac-only release, and whether lineage ships in it is a separate choice), signing, packaging, or any change to the defaults.
