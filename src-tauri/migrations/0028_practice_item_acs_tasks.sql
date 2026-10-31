CREATE TABLE IF NOT EXISTS practice_item_acs_tasks (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES practice_test_items(id) ON DELETE CASCADE,
  acs_task TEXT NOT NULL
);
