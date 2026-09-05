/**
 * Schema migrations.
 *
 * The SQL is imported from the same files the Rust side compiles in, so the
 * desktop database and the development fallback are always the same shape.
 * Add a new file and a new entry here; never edit an applied migration.
 */
import initialSchema from "../../src-tauri/migrations/0001_initial_schema.sql?raw";
import profileDetails from "../../src-tauri/migrations/0002_profile_details.sql?raw";
import personalNote from "../../src-tauri/migrations/0003_personal_note.sql?raw";
import appMetadata from "../../src-tauri/migrations/0004_app_metadata.sql?raw";
import flightLog from "../../src-tauri/migrations/0005_flight_log.sql?raw";

export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, description: "initial_schema", sql: initialSchema },
  { version: 2, description: "profile_details", sql: profileDetails },
  { version: 3, description: "personal_note", sql: personalNote },
  { version: 4, description: "app_metadata", sql: appMetadata },
  { version: 5, description: "flight_log", sql: flightLog },
];

/**
 * Apply any migrations the database has not yet seen.
 *
 * Only used by the fallback drivers — in the desktop app the Rust SQL plugin
 * runs the identical SQL through its own migration table.
 */
export async function applyMigrations(
  exec: (sql: string) => void,
  appliedVersions: Set<number>,
): Promise<void> {
  exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       description TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    exec(migration.sql);
    exec(
      `INSERT INTO schema_migrations (version, description, applied_at)
       VALUES (${migration.version}, '${migration.description}', '${new Date().toISOString()}')`,
    );
  }
}
