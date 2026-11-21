-- BL-106: timed practice-test records move from localStorage onto the attempt row.
-- Additive: three nullable columns. NULL means not timed; old rows are untouched.
ALTER TABLE practice_attempts ADD COLUMN timed_started_ms INTEGER;
ALTER TABLE practice_attempts ADD COLUMN timed_deadline_ms INTEGER;
ALTER TABLE practice_attempts ADD COLUMN timed_seconds_used INTEGER;
