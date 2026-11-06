//! Carries synced ratings onto the active card version during apply (R13b2).
//!
//! One rule for local saves and sync: a rating on ANY other stored version of
//! a material is copied, card by card (`card_reviews::match_cards`: the k-th
//! occurrence of a card maps to the k-th), onto the material's ACTIVE version.
//! This is `card_reviews::carry_into(.., logged = false)`, the same engine a
//! local save runs, so both devices derive identical rows. Ids are
//! `carried_event_id(root, dst_item)` where root is the original rating, so
//! every path to a card gives the same id. The pass is unlogged and
//! deterministic (a pure function of versions, events and the active claim):
//! it writes no receipts, because apply's `ensure_rate_receipts` derives them
//! after the run. Picture cards take part: their region id is part of the card
//! compared, and a version whose recomputed hash differs from its stored hash
//! (for example a picture whose link is still missing) is never a source.
//!
//! - Active only: with no active version nothing is carried. Inactive versions
//!   never gain rows here. They may differ between devices (one holds copies
//!   made while it was active, the other does not) but never hold duplicates.
//! - Union, never deleted: rows carried into a version stay there after
//!   another version becomes active.
//! - Present rule: a (generation, time, rating) already on the destination
//!   item is skipped. When one group has several distinct roots the lowest
//!   root id wins. That tie is not order-independent if a device already holds
//!   the higher root's copy, which needs two different ratings at the same
//!   millisecond on matching cards. It is accepted.
//! - Duplicates and the fold ledger (CARRY-3DEV): two ids can name one rating (an
//!   old-build path id, or a copy that reached a device before its parent). Apply
//!   folds such a foreign duplicate away after the rows land, after activation and
//!   the carry, and after a local save, and keeps the removed row in the local
//!   table `card_review_event_folds` (never exported, never counted) so a later
//!   copy that names it as a parent still resolves to the original rating.
//!   Claim: when every device runs this build, applies every other device's change
//!   files (any order, delays and overlapping re-exports allowed) and the devices
//!   agree on the active version, each card of the active version, in the current
//!   generation, counts one rating per distinct original rating that reached it.
//!   Not claimed: equal ids everywhere (a device keeps its own local copy); two
//!   local-origin copies of one rating, or a copy with missing meta or a
//!   non-derived/erased receipt, which stay and count twice with a warning; two
//!   distinct ratings in the same millisecond on one card (ordered by id); a link
//!   an older build's duplicate pass deleted without a ledger (it returns only if
//!   an overlapping export re-delivers it); delivery that is not all-to-all; old
//!   builds; a device where a schema-34 build already applied the creator file
//!   after a bare claim (that file has a receipt and is never applied again, so B
//!   is not rebuilt unless the file is sent again, and the activation claim that
//!   build dropped is not recovered: the next activation change on any device
//!   makes the devices agree again; clearing receipts to force a re-apply is too
//!   risky); a device that synced a bare update under a schema-34 build (3+
//!   devices only), which can keep an empty-version tombstone and stay on a
//!   different active version until that card set is re-saved (recovery is
//!   deliberately not attempted: a tombstone cannot tell a cleanup from a
//!   reset, and guessing could resurrect a deleted version); and the time before the last link arrives. Inactive versions never
//!   hold two counted copies of one rating once their links are present, but their
//!   contents may differ between devices (the sync carry fills only the active one).
//! - Local vs sync: a logged local carry skips a root with no live receipt,
//!   sync does not (that device catches up on its next incoming event for the
//!   set; in practice only damaged rows). The same id can carry different meta
//!   (the local device after a logged carry, the root's device after a sync
//!   carry); this matters only for order ties at the same millisecond.
//! - A picture link or origin arriving in a later file re-triggers the carry.

use rusqlite::{Connection, OptionalExtension};

use crate::sync::apply::ApplyError;

/// Returns the item ids that gained at least one event, sorted and deduped.
/// Fails closed (writes nothing) without the sync guard row.
pub(crate) fn carry_missing(conn: &Connection, material: &str) -> Result<Vec<String>, ApplyError> {
    let guarded: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM app_metadata WHERE key = 'sync_applying'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if guarded.is_none() {
        return Err(ApplyError::BadRow);
    }
    let active: Option<String> = conn
        .query_row(
            "SELECT id FROM card_versions WHERE source_material_id = ?1 AND is_active = 1",
            [material],
            |r| r.get(0),
        )
        .optional()?;
    let Some(active) = active else {
        return Ok(Vec::new());
    };
    // A version whose items no longer hash to it (a picture link still
    // missing) takes nothing.
    if !crate::card_reviews::version_is_verified(conn, material, &active) {
        return Ok(Vec::new());
    }
    crate::card_reviews::carry_into(conn, material, &active, false).map_err(|_| ApplyError::BadRow)
}
