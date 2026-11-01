use super::*;

#[test]
fn activity_summary_counts_recent_reviews_and_attempts() {
    let root = std::env::temp_dir().join(format!("hfd-phone-activity-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let database = root.join("her-flight-deck.db");
    let connection = Connection::open(&database).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE card_review_events (reviewed_at TEXT);
         CREATE TABLE practice_attempts (started_at TEXT);",
        )
        .unwrap();
    let empty = activity_summary_in(&root).unwrap();
    assert!(empty.latest_review_at.is_none());
    assert_eq!(empty.reviews_last_7_days, 0);
    assert_eq!(empty.attempts_last_7_days, 0);
    connection
        .execute_batch(
            "INSERT INTO card_review_events VALUES (datetime('now', '-8 days')),
          (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')), (datetime('now', '-1 day'));
         INSERT INTO practice_attempts VALUES (datetime('now', '-8 days')),
          (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')), (datetime('now', '-1 day'));",
        )
        .unwrap();
    let summary = activity_summary_in(&root).unwrap();
    let latest: String = connection
        .query_row(
            "SELECT reviewed_at FROM card_review_events WHERE rowid = 3",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(summary.latest_review_at, Some(latest));
    assert_eq!(summary.reviews_last_7_days, 2);
    assert_eq!(summary.attempts_last_7_days, 2);
    drop(connection);
    std::fs::remove_dir_all(root).unwrap();
}
