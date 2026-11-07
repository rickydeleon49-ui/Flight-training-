-- SOURCE-01b: the study-kit queue. Ids, checksums and status only. Never keys,
-- credentials, answers or page text. Local-only: not part of the sync ledger.
CREATE TABLE IF NOT EXISTS kit_queue (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'stopped', 'done')),
  consent_at TEXT
);

CREATE TABLE IF NOT EXISTS kit_queue_item (
  queue_id TEXT NOT NULL REFERENCES kit_queue(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  material_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'running', 'checkpointed', 'saved', 'partial', 'unclear', 'skipped', 'failed')),
  request_id TEXT,
  job_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (queue_id, position)
);

-- At most one open (active or paused) queue: a second start is refused by the
-- database itself, so two windows can never both claim one.
CREATE UNIQUE INDEX IF NOT EXISTS kit_queue_one_open ON kit_queue ((1)) WHERE state IN ('active', 'paused');
