ALTER TABLE homework_activities ADD COLUMN answer TEXT NOT NULL DEFAULT '' CHECK (length(answer) <= 20000);
