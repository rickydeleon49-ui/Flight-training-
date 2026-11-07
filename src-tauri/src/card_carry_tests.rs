//! Per-card carry engine (R13b1): `match_cards`, `root_event_id` and the
//! unlogged `carry_into` the sync apply will use. Every value is synthetic.

use super::*;

const M: &str = "mat-carry";
const NOW: &str = "2026-11-05T10:00:00.000Z";

fn card(front: &str, back: &str) -> CanonicalCard {
    CanonicalCard {
        visual_region_id: None,
        front: front.into(),
        back: back.into(),
        source_page: None,
        origin: None,
    }
}

#[test]
fn match_cards_maps_the_kth_copy_to_the_kth_copy() {
    let x = card("x", "1");
    let y = card("y", "2");
    // Moved cards match wherever they now sit.
    assert_eq!(
        match_cards(&[x.clone(), y.clone()], &[y.clone(), x.clone()]),
        vec![(0, 1), (1, 0)]
    );
    // Duplicates: first copy to first copy, second to second.
    assert_eq!(
        match_cards(
            &[x.clone(), x.clone(), y.clone()],
            &[y.clone(), x.clone(), x.clone()]
        ),
        vec![(0, 1), (1, 2), (2, 0)]
    );
    // Extra copies on the source side get no match; so do extras on the dest side.
    assert_eq!(
        match_cards(&[x.clone(), x.clone()], std::slice::from_ref(&x)),
        vec![(0, 0)]
    );
    assert_eq!(
        match_cards(std::slice::from_ref(&x), &[x.clone(), x.clone()]),
        vec![(0, 0)]
    );
    // An edited card has no match; a deleted card does not stop the others.
    assert_eq!(
        match_cards(&[x.clone(), y.clone()], &[card("x", "changed"), y.clone()]),
        vec![(1, 1)]
    );
    assert!(match_cards(&[], &[x]).is_empty());
}

#[test]
fn match_cards_compares_every_field_exactly() {
    let base = card("front", "back");
    let mut paged = base.clone();
    paged.source_page = Some(3);
    let mut owned = base.clone();
    owned.origin = Some("user".into());
    let mut picture = base.clone();
    picture.visual_region_id = Some("a".repeat(64));
    let mut other_picture = base.clone();
    other_picture.visual_region_id = Some("b".repeat(64));
    // A missing page, origin or region is not the same as a present one.
    for other in [&paged, &owned, &picture] {
        assert!(match_cards(std::slice::from_ref(&base), std::slice::from_ref(other)).is_empty());
        assert!(match_cards(std::slice::from_ref(other), std::slice::from_ref(&base)).is_empty());
    }
    // A picture never matches a plain card or a different picture.
    assert!(match_cards(&[picture.clone()], &[other_picture.clone()]).is_empty());
    assert_eq!(
        match_cards(&[picture.clone()], &[picture.clone()]),
        vec![(0, 0)]
    );
    // Bytes are exact: no trimming, no case folding.
    assert!(match_cards(&[card("Front", "back")], &[card("front", "back")]).is_empty());
    assert!(match_cards(&[card("front ", "back")], &[card("front", "back")]).is_empty());
    // An absent page (null) equals an absent page.
    assert_eq!(
        match_cards(std::slice::from_ref(&base), std::slice::from_ref(&base)),
        vec![(0, 0)]
    );
}

fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute_batch("CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY);")
        .unwrap();
    for m in crate::migrations() {
        conn.execute_batch(m.sql).unwrap();
        conn.execute(
            "INSERT INTO _sqlx_migrations (version) VALUES (?1)",
            [m.version],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?1, 'Synthetic', ?2, ?2)",
        params![M, NOW],
    )
    .unwrap();
    conn
}

fn json_of(list: &[(&str, &str)]) -> String {
    serde_json::to_string(
        &list
            .iter()
            .map(|(f, b)| json!({"front": f, "back": b, "sourcePage": null}))
            .collect::<Vec<_>>(),
    )
    .unwrap()
}

fn version_of(list: &[(&str, &str)]) -> CardVersion {
    let SavedCards::Ok(cards) = parse_saved_cards(Some(&json_of(list))) else {
        panic!("cards")
    };
    card_version(M, &cards)
}

/// Writes the saved set (as a save would), then runs the carry from `before`.
fn save(conn: &mut Connection, before: &[(&str, &str)], after: &[(&str, &str)]) {
    conn.execute(
        "INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
         VALUES (?1, 'Synthetic', '', '[]', ?2, '', 'import', '', ?3, ?3)
         ON CONFLICT(source_material_id) DO UPDATE SET flashcards_json = excluded.flashcards_json",
        params![M, json_of(after), NOW],
    )
    .unwrap();
    let tx = conn.transaction().unwrap();
    carry_review_state(&tx, M, &json_of(before), &json_of(after), "import", NOW);
    tx.commit().unwrap();
}

fn rate_on(conn: &mut Connection, list: &[(&str, &str)], ordinal: usize, n: u32) -> String {
    std::thread::sleep(Duration::from_millis(3));
    let version = version_of(list);
    let item = version.items[ordinal].item_id.clone();
    let tx = conn.transaction().unwrap();
    let revision: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(revision), 0) FROM card_review_state WHERE item_id = ?1",
            [&item],
            |r| r.get(0),
        )
        .unwrap();
    let id = format!("c5000000-0000-4000-8000-{n:012x}");
    let value = json!({
        "action": "rate", "rating": "good", "operationId": id, "materialId": M,
        "versionContentHash": version.content_hash, "itemId": item,
        "expectedGeneration": 0, "expectedRevision": revision,
    });
    let action = decode_card_action(&value).unwrap();
    execute_card_review_transaction(&tx, &action, &value).unwrap();
    tx.commit().unwrap();
    id
}

fn events_of(conn: &Connection, item: &str) -> Vec<String> {
    conn.prepare("SELECT id FROM card_review_events WHERE item_id = ?1 ORDER BY reviewed_at, id")
        .unwrap()
        .query_map([item], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn root_event_id_follows_old_build_path_ids_back_to_the_original_rating() {
    let (a, b, c, d) = (
        [("a", "1")].as_slice(),
        [("a", "1"), ("b", "2")].as_slice(),
        [("a", "1"), ("b", "2"), ("c", "3")].as_slice(),
        [("a", "1"), ("b", "2"), ("c", "3"), ("d", "4")].as_slice(),
    );
    let mut conn = db();
    save(&mut conn, &[], a);
    // The very first save of a list stores nothing; rating stores version A.
    let e = rate_on(&mut conn, a, 0, 1);
    save(&mut conn, a, b);
    save(&mut conn, b, c);
    let (_a0, b0, c0, d0) = (
        version_of(a).items[0].item_id.clone(),
        version_of(b).items[0].item_id.clone(),
        version_of(c).items[0].item_id.clone(),
        version_of(d).items[0].item_id.clone(),
    );
    // New builds always make one-hop ids.
    assert_eq!(events_of(&conn, &b0), vec![carried_event_id(&e, &b0)]);
    assert_eq!(events_of(&conn, &c0), vec![carried_event_id(&e, &c0)]);
    assert_eq!(root_event_id(&conn, M, &e).unwrap(), e);
    assert_eq!(
        root_event_id(&conn, M, &carried_event_id(&e, &c0)).unwrap(),
        e
    );

    // Replace C's copy with the id an old build made: carried(carried(e, B), C).
    let path_id = carried_event_id(&carried_event_id(&e, &b0), &c0);
    let one_hop = carried_event_id(&e, &c0);
    conn.execute(
        "UPDATE card_review_events SET id = ?1 WHERE id = ?2",
        params![path_id, one_hop],
    )
    .unwrap();
    conn.execute(
        "UPDATE card_review_operations SET operation_id = ?1 WHERE operation_id = ?2",
        params![path_id, one_hop],
    )
    .unwrap();
    assert_eq!(root_event_id(&conn, M, &path_id).unwrap(), e);
    // The next carry gives carried(e, D), however many hops the sources took.
    save(&mut conn, c, d);
    assert_eq!(events_of(&conn, &d0), vec![carried_event_id(&e, &d0)]);
    crate::backup::verify_application_connection(&conn).unwrap();

    // A missing parent makes the event its own root.
    let orphan = carried_event_id("ffffffff-ffff-4fff-8fff-ffffffffffff", &d0);
    conn.execute(
        "INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
         SELECT ?1, item_id, generation, 'again', '2026-11-05T10:30:00.000Z', scheduler_version, prior_state_json, next_state_json
         FROM card_review_events WHERE item_id = ?2 LIMIT 1",
        params![orphan, d0],
    )
    .unwrap();
    assert_eq!(root_event_id(&conn, M, &orphan).unwrap(), orphan);
    // An id nobody holds is its own root.
    assert_eq!(root_event_id(&conn, M, "missing").unwrap(), "missing");
}

#[test]
fn an_unlogged_carry_copies_the_roots_provenance_and_writes_no_receipts() {
    let (a, b) = (
        [("a", "1"), ("b", "2")].as_slice(),
        [("a", "1"), ("c", "3")].as_slice(),
    );
    let mut conn = db();
    save(&mut conn, &[], a);
    let e = rate_on(&mut conn, a, 0, 2);
    conn.execute(
        "UPDATE sync_row_meta SET device_id = 'phone-1', changed_at = '2026-11-05T09:00:00.000Z'
         WHERE table_name = 'card_review_events' AND row_id = ?1",
        [&e],
    )
    .unwrap();
    let dst = version_of(b);
    let (a0, b0) = (
        version_of(a).items[0].item_id.clone(),
        dst.items[0].item_id.clone(),
    );
    // Store the destination without the logged carry.
    {
        let tx = conn.transaction().unwrap();
        materialize(&tx, M, &dst, "import", NOW).unwrap();
        tx.commit().unwrap();
    }
    assert!(events_of(&conn, &b0).is_empty());
    // Unlogged needs the sync guard row: it fails closed without it.
    assert_eq!(
        carry_into(&conn, M, &dst.version_id, false),
        Err(CardReviewErrorCode::InvalidState)
    );
    assert!(events_of(&conn, &b0).is_empty());
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('sync_applying', 'x')",
        [],
    )
    .unwrap();
    let gained = carry_into(&conn, M, &dst.version_id, false).unwrap();
    assert_eq!(gained, vec![b0.clone()]);
    let carried = carried_event_id(&e, &b0);
    assert_eq!(events_of(&conn, &b0), vec![carried.clone()]);
    let meta: (String, String) = conn
        .query_row(
            "SELECT device_id, changed_at FROM sync_row_meta WHERE table_name = 'card_review_events' AND row_id = ?1",
            [&carried],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(meta, ("phone-1".into(), "2026-11-05T09:00:00.000Z".into()));
    let receipts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM card_review_operations WHERE operation_id = ?1",
            [&carried],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(receipts, 0);
    // The item had no events and no state, and got them from one source item:
    // its state is a copy of that item's.
    let copied: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM card_review_state s JOIN card_review_state o ON o.item_id = ?2
             WHERE s.item_id = ?1 AND s.reps = o.reps AND s.due_at = o.due_at AND s.revision = o.revision",
            params![b0, a0],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(copied, 1);
    // Running it again adds nothing (the present rule).
    assert!(carry_into(&conn, M, &dst.version_id, false)
        .unwrap()
        .is_empty());
}

fn long_chain_db(versions: usize, cards: usize, ratings: usize) -> (Connection, Vec<String>) {
    let mut conn = db();
    let list = |n: usize| -> Vec<(String, String)> {
        (0..cards)
            .map(|i| {
                (
                    format!("front {i}"),
                    if i == 0 {
                        format!("back v{n}")
                    } else {
                        format!("back {i}")
                    },
                )
            })
            .collect()
    };
    fn as_refs(v: &[(String, String)]) -> Vec<(&str, &str)> {
        v.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect()
    }
    let first = list(0);
    save(&mut conn, &[], &as_refs(&first));
    let mut prior = first;
    let mut last = Vec::new();
    for n in 0..ratings {
        last.push(rate_on(
            &mut conn,
            &as_refs(&prior),
            1 + n % (cards - 1),
            1 + n as u32,
        ));
    }
    for n in 1..versions {
        let next = list(n);
        save(&mut conn, &as_refs(&prior), &as_refs(&next));
        prior = next;
    }
    (conn, last)
}

/// R13b2 perf guard (R13b1 audit #3): 40 versions x 50 cards x 3 ratings. One
/// local save and one unlogged sync carry each finish well inside the (generous,
/// CI-loaded) limit.
#[test]
fn a_long_version_chain_carries_in_seconds() {
    let (mut conn, _) = long_chain_db(40, 50, 3);
    let start = std::time::Instant::now();
    let last: Vec<(String, String)> = (0..50)
        .map(|i| {
            (
                format!("front {i}"),
                if i == 0 {
                    "back v39".into()
                } else {
                    format!("back {i}")
                },
            )
        })
        .collect();
    let mut next = last.clone();
    next[0].1 = "back v40".into();
    let r = |v: &Vec<(String, String)>| -> Vec<(String, String)> { v.clone() };
    let (l, n) = (r(&last), r(&next));
    let lr: Vec<(&str, &str)> = l.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    let nr: Vec<(&str, &str)> = n.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    save(&mut conn, &lr, &nr);
    let local = start.elapsed();
    assert!(
        local < std::time::Duration::from_secs(10),
        "local save took {local:?}"
    );
    // Sync carry onto the active version with the guard held: nothing new, but
    // it reads every version and event.
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('sync_applying', 'x')",
        [],
    )
    .unwrap();
    let active: String = conn
        .query_row(
            "SELECT id FROM card_versions WHERE source_material_id = ?1 AND is_active = 1",
            [M],
            |r| r.get(0),
        )
        .unwrap();
    let start = std::time::Instant::now();
    carry_into(&conn, M, &active, false).unwrap();
    let sync = start.elapsed();
    assert!(
        sync < std::time::Duration::from_secs(10),
        "sync carry took {sync:?}"
    );
}

/* ------------------------------------------------------------------ */
/* CARRY-3DEV: the fold ledger, fold_plan and the carry receipt choice */
/* ------------------------------------------------------------------ */

const OWN: &str = "local-1";
const PHONE_DEV: &str = "phone-1";

const LA: &[(&str, &str)] = &[("a", "1")];
const LB: &[(&str, &str)] = &[("a", "1"), ("b", "2")];
const LC: &[(&str, &str)] = &[("a", "1"), ("b", "2"), ("c", "3")];
const LD: &[(&str, &str)] = &[("a", "1"), ("b", "2"), ("c", "3"), ("d", "4")];

fn item_of(list: &[(&str, &str)]) -> String {
    version_of(list).items[0].item_id.clone()
}

/// A database with a device id, the rating `e` on A's card, and the lists
/// A -> B -> C -> D saved in order (each save carries the rating onward as a new
/// build does). Returns the connection and `e`.
fn chain_db() -> (Connection, String) {
    let mut conn = db();
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('device_id', ?1)",
        [OWN],
    )
    .unwrap();
    save(&mut conn, &[], LA);
    let e = rate_on(&mut conn, LA, 0, 1);
    save(&mut conn, LA, LB);
    save(&mut conn, LB, LC);
    save(&mut conn, LC, LD);
    (conn, e)
}

fn guarded<T>(conn: &Connection, f: impl FnOnce() -> T) -> T {
    conn.execute("DELETE FROM app_metadata WHERE key = 'sync_applying'", [])
        .unwrap();
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('sync_applying', 'test')",
        [],
    )
    .unwrap();
    let out = f();
    conn.execute("DELETE FROM app_metadata WHERE key = 'sync_applying'", [])
        .unwrap();
    out
}

/// What a sync apply stores for a copy that came from another device: the event
/// row (a copy of `like`'s time and rating), the meta naming `device`, and the
/// derived receipt (unless `receipt` is false). `device` None writes no meta.
fn foreign_copy(
    conn: &Connection,
    like: &str,
    id: &str,
    item: &str,
    device: Option<&str>,
    receipt: bool,
) {
    guarded(conn, || {
        conn.execute(
            "INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
             SELECT ?1, ?2, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json
             FROM card_review_events WHERE id = ?3",
            params![id, item, like],
        )
        .unwrap();
        if let Some(device) = device {
            conn.execute(
                "INSERT OR REPLACE INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted)
                 VALUES ('card_review_events', ?1, ?2, '2026-11-05T09:00:00.000Z', 0)",
                params![id, device],
            )
            .unwrap();
        }
        if receipt {
            crate::sync::receipts::ensure_rate_receipts(conn, None).unwrap();
        }
    });
}

fn plan_ids(conn: &Connection) -> Vec<String> {
    fold_plan(conn, M)
        .unwrap()
        .into_iter()
        .map(|r| r.id)
        .collect()
}

fn folds(conn: &Connection) -> Vec<String> {
    conn.prepare("SELECT id FROM card_review_event_folds ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

/// The old duplicate-pass unit, rewritten for `fold_plan`: only a foreign copy
/// goes, the root copy stays whatever the id order, a distinct rating at the
/// same millisecond is never a duplicate, and a different card is untouched.
#[test]
fn fold_plan_folds_only_the_foreign_copy_and_keeps_the_root_copy() {
    let (conn, e) = chain_db();
    let (b0, c0) = (item_of(LB), item_of(LC));
    let root_copy = carried_event_id(&e, &c0);
    let path = carried_event_id(&carried_event_id(&e, &b0), &c0);
    assert_ne!(root_copy, path);
    assert!(plan_ids(&conn).is_empty());
    foreign_copy(&conn, &root_copy, &path, &c0, Some(PHONE_DEV), true);
    let plan = fold_plan(&conn, M).unwrap();
    assert_eq!(plan.len(), 1);
    assert_eq!(
        (plan[0].id.as_str(), plan[0].keeper.as_str()),
        (path.as_str(), root_copy.as_str())
    );
    // A distinct rating on the same card with the same time and rating (an
    // unrelated synthetic root) is never a duplicate.
    let other = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    foreign_copy(&conn, &root_copy, other, &c0, Some(PHONE_DEV), true);
    assert_eq!(plan_ids(&conn), vec![path.clone()]);
    // The original rating on A's card is not a duplicate of its copies.
    assert!(!plan_ids(&conn).contains(&e));
}

/// A foreign parent copy folds, and a child that names it still resolves to the
/// original rating through the ledger, before and after the fold.
#[test]
fn a_foreign_parent_copy_folds_and_its_child_still_resolves_through_the_ledger() {
    let (conn, e) = chain_db();
    let (b0, c0, d0) = (item_of(LB), item_of(LC), item_of(LD));
    let bc = carried_event_id(&e, &b0);
    let root_copy = carried_event_id(&e, &c0);
    let parent = carried_event_id(&bc, &c0);
    let child = carried_event_id(&parent, &d0);
    foreign_copy(&conn, &root_copy, &parent, &c0, Some(PHONE_DEV), true);
    foreign_copy(&conn, &root_copy, &child, &d0, Some(PHONE_DEV), true);
    assert_eq!(root_event_id(&conn, M, &child).unwrap(), e);
    let mut want = vec![parent.clone(), child.clone()];
    want.sort();
    // The child also duplicates carried(e, d0) on D: both fold.
    assert_eq!(plan_ids(&conn), want);
    let done = guarded(&conn, || crate::sync::apply::fold_material(&conn, M)).unwrap();
    assert_eq!(done.len(), 2);
    assert_eq!(folds(&conn), want);
    assert_eq!(events_of(&conn, &c0), vec![root_copy.clone()]);
    assert_eq!(events_of(&conn, &d0), vec![carried_event_id(&e, &d0)]);
    // The removed rows are gone with their meta and derived receipts.
    for id in [&parent, &child] {
        for sql in [
            "SELECT COUNT(*) FROM sync_row_meta WHERE table_name = 'card_review_events' AND row_id = ?1",
            "SELECT COUNT(*) FROM card_review_operations WHERE operation_id = ?1",
        ] {
            assert_eq!(conn.query_row(sql, [id], |r| r.get::<_, i64>(0)).unwrap(), 0);
        }
    }
    // The ledger still resolves a folded id and its child.
    assert_eq!(root_event_id(&conn, M, &parent).unwrap(), e);
    assert_eq!(root_event_id(&conn, M, &child).unwrap(), e);
    // A second pass has nothing to do and the ledger is not written twice.
    assert!(plan_ids(&conn).is_empty());
    crate::backup::verify_application_connection(&conn).unwrap();
}

/// Two local-origin copies of one rating are both kept (the documented
/// residual); a local copy beside a foreign one keeps the local one.
#[test]
fn protected_local_copies_are_kept_and_only_the_foreign_one_folds() {
    let (conn, e) = chain_db();
    let (b0, c0) = (item_of(LB), item_of(LC));
    let root_copy = carried_event_id(&e, &c0);
    let path = carried_event_id(&carried_event_id(&e, &b0), &c0);
    // Local origin: meta names this device.
    foreign_copy(&conn, &root_copy, &path, &c0, Some(OWN), true);
    assert!(
        plan_ids(&conn).is_empty(),
        "two local copies stay (count 2)"
    );
    // Local by a `local_changes` row although the meta names another device (a
    // restore onto a new device id).
    conn.execute(
        "UPDATE sync_row_meta SET device_id = ?2 WHERE table_name = 'card_review_events' AND row_id = ?1",
        params![path, PHONE_DEV],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO local_changes (table_name, row_id, op, changed_at) VALUES ('card_review_events', ?1, 'insert', ?2)",
        params![path, NOW],
    )
    .unwrap();
    assert!(plan_ids(&conn).is_empty());
    // Local + foreign: only the foreign one folds, whatever the ids sort like.
    let third = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    foreign_copy(&conn, &root_copy, third, &c0, Some(PHONE_DEV), true);
    // `third` has no parent, so it is its own root and a distinct rating: kept.
    assert!(plan_ids(&conn).is_empty());
}

#[test]
fn a_missing_meta_or_a_non_derived_receipt_keeps_the_copy_and_no_receipt_folds_clean() {
    let (conn, e) = chain_db();
    let (b0, c0) = (item_of(LB), item_of(LC));
    let root_copy = carried_event_id(&e, &c0);
    let path = carried_event_id(&carried_event_id(&e, &b0), &c0);
    // Missing meta counts as local: kept.
    foreign_copy(&conn, &root_copy, &path, &c0, None, true);
    assert!(plan_ids(&conn).is_empty());
    // Foreign with no receipt at all: folds, and leaves no orphan receipt.
    conn.execute(
        "INSERT INTO sync_row_meta (table_name, row_id, device_id, changed_at, deleted) VALUES ('card_review_events', ?1, ?2, ?3, 0)",
        params![path, PHONE_DEV, NOW],
    )
    .unwrap();
    conn.execute(
        "DELETE FROM card_review_operations WHERE operation_id = ?1",
        [&path],
    )
    .unwrap();
    assert_eq!(plan_ids(&conn), vec![path.clone()]);
    // An erased receipt, or one that is not the derived shape, keeps it.
    for sql in [
        "INSERT INTO card_review_operations (operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json) VALUES (?1, 'rate', ?2, 0, ?3, ?4, 1, NULL)",
        "INSERT INTO card_review_operations (operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json) VALUES (?1, 'rate', ?2, 0, ?3, ?4, 0, '{}')",
    ] {
        conn.execute("DELETE FROM card_review_operations WHERE operation_id = ?1", [&path])
            .unwrap();
        let hash = if sql.contains("is_erased, result_json) VALUES (?1, 'rate', ?2, 0, ?3, ?4, 1") {
            sha256_hex(&path)
        } else {
            "0".repeat(64)
        };
        conn.execute(sql, params![path, M, hash, NOW]).unwrap();
        assert!(plan_ids(&conn).is_empty(), "{sql}");
    }
}

/// Two distinct ratings at the same millisecond on one card (no hash relates
/// them) are both kept.
#[test]
fn a_distinct_rating_at_the_same_millisecond_is_not_a_duplicate() {
    let (conn, e) = chain_db();
    let c0 = item_of(LC);
    let other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    foreign_copy(
        &conn,
        &carried_event_id(&e, &c0),
        other,
        &c0,
        Some(PHONE_DEV),
        true,
    );
    assert!(plan_ids(&conn).is_empty());
    assert_eq!(events_of(&conn, &c0).len(), 2);
}

/// Replaces the root's live receipt, or gives the root's id to the ledger, and
/// saves a list that gains the card: the receipt and the source fields must
/// come from one candidate.
#[test]
fn the_logged_carry_takes_its_receipt_from_a_candidate_even_when_the_root_is_a_fold() {
    let (mut conn, e) = chain_db();
    let (a0, b0) = (item_of(LA), item_of(LB));
    let bc = carried_event_id(&e, &b0);
    // Move the root into the ledger (as a fold pass would), keep Bc.
    guarded(&conn, || {
        conn.execute(
            "INSERT INTO card_review_event_folds (id, item_id, generation, rating, reviewed_at, device_id, changed_at, folded_at)
             SELECT id, item_id, generation, rating, reviewed_at, NULL, NULL, ?2 FROM card_review_events WHERE id = ?1",
            params![e, NOW],
        )
        .unwrap();
        conn.execute("DELETE FROM card_review_events WHERE id = ?1", [&e])
            .unwrap();
        conn.execute(
            "DELETE FROM card_review_operations WHERE operation_id = ?1",
            [&e],
        )
        .unwrap();
    });
    assert_eq!(root_event_id(&conn, M, &bc).unwrap(), e);
    assert!(events_of(&conn, &a0).is_empty());
    // A mark only Bc's receipt carries, so the carried receipt must be Bc's.
    conn.execute(
        "UPDATE card_review_operations SET result_json = json_set(result_json, '$.revision', 77) WHERE operation_id = ?1",
        [&bc],
    )
    .unwrap();
    // Save a list that keeps card a and b and adds E.
    let le: &[(&str, &str)] = &[("a", "1"), ("b", "2"), ("e", "5")];
    save(&mut conn, LD, le);
    let e0 = item_of(le);
    let want = carried_event_id(&e, &e0);
    assert_eq!(
        events_of(&conn, &e0),
        vec![want.clone()],
        "the fold root carries"
    );
    let result: String = conn
        .query_row(
            "SELECT result_json FROM card_review_operations WHERE operation_id = ?1",
            [&want],
            |r| r.get(0),
        )
        .unwrap();
    let result: Value = serde_json::from_str(&result).unwrap();
    assert_eq!(result["revision"], json!(77), "the receipt is Bc's");
    assert_eq!(result["itemId"], json!(e0));
    // No candidate (the only copy's receipt is gone): the carry skips that card.
    let lf: &[(&str, &str)] = &[("a", "1"), ("b", "2"), ("f", "6")];
    conn.execute(
        "DELETE FROM card_review_operations WHERE action = 'rate' AND is_erased = 0",
        [],
    )
    .unwrap();
    save(&mut conn, le, lf);
    let f0 = item_of(lf);
    assert!(
        events_of(&conn, &f0).is_empty(),
        "a fold root with no candidate receipt is skipped"
    );
}

/// Fix pass 2 (N4): the root's own receipt is used only when the version that
/// holds the root's item is a verified source. Here A (the root's version) is no
/// longer verified, so the receipt, the fields and the id must all come from one
/// matched copy (a carried copy on a later version), never the root's receipt
/// named against a copy's version.
#[test]
fn a_root_on_an_unverified_version_carries_from_a_copy_receipt() {
    let (mut conn, e) = chain_db();
    let a0 = item_of(LA);
    // Break A's stored cards so it no longer verifies: the root sits on it.
    conn.execute(
        "UPDATE card_items SET front = 'broken' WHERE id = ?1",
        [&a0],
    )
    .unwrap();
    assert!(!events_of(&conn, &a0).is_empty(), "the root is still there");
    // Every copy's receipt carries a mark the root's receipt does not.
    conn.execute(
        "UPDATE card_review_operations SET result_json = json_set(result_json, '$.revision', 77)
         WHERE action = 'rate' AND operation_id != ?1",
        [&e],
    )
    .unwrap();
    let le: &[(&str, &str)] = &[("a", "1"), ("b", "2"), ("e", "5")];
    save(&mut conn, LD, le);
    let e0 = item_of(le);
    let want = carried_event_id(&e, &e0);
    assert_eq!(events_of(&conn, &e0), vec![want.clone()]);
    let result: String = conn
        .query_row(
            "SELECT result_json FROM card_review_operations WHERE operation_id = ?1",
            [&want],
            |r| r.get(0),
        )
        .unwrap();
    let result: Value = serde_json::from_str(&result).unwrap();
    assert_eq!(
        result["revision"],
        json!(77),
        "the receipt is a copy's: {result}"
    );
}

/// A rating the ledger holds is never minted again on a card that is gone.
#[test]
fn a_carried_id_that_is_a_fold_is_not_minted_again() {
    let (mut conn, e) = chain_db();
    let b0 = item_of(LB);
    let bc = carried_event_id(&e, &b0);
    // Fold Bc away (as if a pass had), then re-save the list B: nothing re-mints it.
    guarded(&conn, || {
        conn.execute(
            "INSERT INTO card_review_event_folds (id, item_id, generation, rating, reviewed_at, device_id, changed_at, folded_at)
             SELECT id, item_id, generation, rating, reviewed_at, NULL, NULL, ?2 FROM card_review_events WHERE id = ?1",
            params![bc, NOW],
        )
        .unwrap();
        conn.execute("DELETE FROM card_review_events WHERE id = ?1", [&bc])
            .unwrap();
        conn.execute(
            "DELETE FROM card_review_operations WHERE operation_id = ?1",
            [&bc],
        )
        .unwrap();
    });
    save(&mut conn, LD, LB);
    assert!(!events_of(&conn, &b0).contains(&bc));
}

/// A chain longer than the version count resolves: an A -> B -> A -> B revert
/// chain walks more hops than there are versions. Built directly, with mixed
/// live and ledger links.
#[test]
fn a_chain_longer_than_the_version_count_resolves_through_events_and_folds() {
    let (conn, e) = chain_db();
    let (a0, b0) = (item_of(LA), item_of(LB));
    // Hops alternate between two cards (two versions' worth), six hops long.
    let mut prev = e.clone();
    let mut ids = Vec::new();
    for n in 0..6 {
        let item = if n % 2 == 0 { &b0 } else { &a0 };
        let id = carried_event_id(&prev, item);
        ids.push((id.clone(), item.clone()));
        prev = id;
    }
    for (n, (id, item)) in ids.iter().enumerate() {
        if id == &carried_event_id(&e, &b0) || events_of(&conn, item).contains(id) {
            continue;
        }
        if n % 2 == 0 {
            foreign_copy(&conn, &e, id, item, Some(PHONE_DEV), true);
        } else {
            // Odd hops live in the ledger.
            conn.execute(
                "INSERT OR IGNORE INTO card_review_event_folds (id, item_id, generation, rating, reviewed_at, device_id, changed_at, folded_at)
                 SELECT ?1, ?2, generation, rating, reviewed_at, NULL, NULL, ?4 FROM card_review_events WHERE id = ?3",
                params![id, item, e, NOW],
            )
            .unwrap();
        }
    }
    let last = &ids.last().unwrap().0;
    assert_eq!(root_event_id(&conn, M, last).unwrap(), e);
}

/// The walk is bounded by its link count; a chain that is longer than the bound
/// (or a cycle, which the same guard stops) makes the start its own root.
#[test]
fn the_root_walk_terminates_at_its_bound() {
    let mk = |id: String, item: &str| StoredEvent {
        fold: false,
        id,
        item_id: item.to_string(),
        generation: 0,
        rating: "good".into(),
        reviewed_at: NOW.into(),
        scheduler_version: String::new(),
        prior: String::new(),
        next: String::new(),
        device: String::new(),
        changed_at: NOW.into(),
    };
    let mut events = vec![mk("root".into(), "i0")];
    for n in 1..8 {
        let id = carried_event_id(&events[n - 1].id, &format!("i{n}"));
        events.push(mk(id, &format!("i{n}")));
    }
    let by_key = events_by_key(&events);
    assert_eq!(root_index(&events, &by_key, 7, 16), 0);
    assert_eq!(root_index(&events, &by_key, 7, 2), 7, "bounded: the start");
}

/// Fix pass 2 (N11): a real cycle 0 -> 1 -> 2 -> 0 (not writable as hash ids,
/// so the walk takes the parent lookup as a closure) returns the start; a
/// self-free chain returns its end.
#[test]
fn walk_root_returns_the_start_on_a_real_cycle_and_the_end_of_a_chain() {
    let cycle = |i: usize| Some((i + 1) % 3);
    assert_eq!(walk_root(0, 16, cycle), 0);
    assert_eq!(walk_root(1, 16, cycle), 1);
    let chain = |i: usize| (i < 4).then_some(i + 1);
    assert_eq!(walk_root(0, 16, chain), 4);
    assert_eq!(walk_root(0, 2, chain), 0, "past the bound: the start");
}

/// Perf guard for the fold (CARRY-3DEV): a material with many ratings through
/// both passes of the planner (the cheap exit, then a real class) stays fast.
#[test]
fn a_many_event_material_folds_in_seconds_through_both_passes() {
    let (conn, _) = long_chain_db(5, 20, 190);
    let events: i64 = conn
        .query_row("SELECT COUNT(*) FROM card_review_events", [], |r| r.get(0))
        .unwrap();
    assert!(events > 500, "{events}");
    conn.execute(
        "INSERT INTO app_metadata (key, value) VALUES ('device_id', ?1)",
        [OWN],
    )
    .unwrap();
    let start = std::time::Instant::now();
    // Pass 1: nothing to fold (the cheap exit and a full scan agree).
    assert!(plan_ids(&conn).is_empty());
    // Pass 2: one foreign path duplicate among many ratings.
    let (src, item): (String, String) = conn
        .query_row(
            "SELECT e.id, e.item_id FROM card_review_events e ORDER BY e.reviewed_at, e.id LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    // A second id for the same rating on the same card: its parent is `src`.
    let path = carried_event_id(&src, &item);
    foreign_copy(&conn, &src, &path, &item, Some(PHONE_DEV), true);
    assert_eq!(plan_ids(&conn), vec![path.clone()]);
    let done = guarded(&conn, || crate::sync::apply::fold_material(&conn, M)).unwrap();
    assert_eq!(done.len(), 1);
    assert!(plan_ids(&conn).is_empty());
    let elapsed = start.elapsed();
    assert!(
        elapsed < std::time::Duration::from_secs(10),
        "planning took {elapsed:?}"
    );
}
