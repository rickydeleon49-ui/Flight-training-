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
//! - Residual: an old-build path id whose intermediate copy is absent cannot be
//!   resolved to its root (it counts as its own root), so apply's duplicate
//!   pass cannot fold it and it can still count twice. Dropping an intermediate
//!   path copy also degrades later resolution: a deeper old-build copy
//!   `carried(P, D)` arriving in a later file finds no parent and is its own
//!   root, so it double-counts only if the device already holds `carried(e, D)`.
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
