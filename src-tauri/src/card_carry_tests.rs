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
