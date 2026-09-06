/**
 * Migrations are exercised against real SQLite, including the case that
 * matters most: applying a new migration to a database that already holds
 * someone's training data.
 */
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { applyMigrations, MIGRATIONS } from "./migrations";

/** Apply migrations up to and including `throughVersion`. */
async function migrate(db: DatabaseSync, throughVersion: number): Promise<void> {
  const applied = new Set<number>();
  try {
    for (const row of db.prepare("SELECT version FROM schema_migrations").all()) {
      applied.add(Number((row as { version: number }).version));
    }
  } catch {
    // No migrations table yet.
  }
  for (const migration of MIGRATIONS) {
    if (migration.version > throughVersion) applied.add(migration.version);
  }
  await applyMigrations((sql) => db.exec(sql), applied);
}

describe("migrations", () => {
  it("are numbered uniquely and in ascending order", () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("applies cleanly to an empty database", async () => {
    const db = new DatabaseSync(":memory:");
    await migrate(db, Number.MAX_SAFE_INTEGER);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("settings");
    expect(tables).toContain("transactions");
    expect(tables).toContain("app_metadata");
    expect(tables).toContain("pilot_toolkit");
    expect(tables).toContain("ai_study_sets");
    db.close();
  });

  it("upgrades a database that already holds data, without losing any", async () => {
    const db = new DatabaseSync(":memory:");

    // A database as it stood before the profile-details migration existed.
    await migrate(db, 1);
    const columnsBefore = db
      .prepare("SELECT name FROM pragma_table_info('settings')")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(columnsBefore).not.toContain("accent_color");

    db.prepare(
      `INSERT INTO settings (id, pilot_name, certificate_goal, current_focus,
         created_at, updated_at)
       VALUES ('profile', 'Ava', 'Private Pilot', 'Landings', 'then', 'then')`,
    ).run();
    db.prepare(
      `INSERT INTO milestones (id, title, description, position, status, created_at, updated_at)
       VALUES ('m1', 'Build Landing Confidence', '', 0, 'in_progress', 'then', 'then')`,
    ).run();
    db.prepare(
      `INSERT INTO journal_entries (id, date, created_at, updated_at)
       VALUES ('j1', '2026-09-01', 'then', 'then')`,
    ).run();

    // Now bring it up to date, as an existing install would on next launch.
    await migrate(db, Number.MAX_SAFE_INTEGER);

    const profile = db.prepare("SELECT * FROM settings WHERE id = 'profile'").get() as Record<
      string,
      unknown
    >;
    expect(profile.pilot_name).toBe("Ava");
    expect(profile.current_focus).toBe("Landings");
    // New columns arrive with usable defaults rather than nulls.
    expect(profile.accent_color).toBe("berry");
    expect(profile.flight_school).toBe("");
    expect(profile.medical_expiry).toBeNull();
    expect(profile.why_note).toBe("");
    expect(profile.photo).toBeNull();

    const milestones = db.prepare("SELECT COUNT(*) c FROM milestones").get() as { c: number };
    expect(milestones.c).toBe(1);

    const journal = db.prepare("SELECT * FROM journal_entries WHERE id = 'j1'").get() as Record<
      string,
      unknown
    >;
    expect(journal.aircraft_type).toBe("");
    expect(journal.total_time).toBeNull();
    db.close();
  });

  it("carries a fully personalized profile through every later migration", async () => {
    // The promise behind app updates: her name, school, why-note, photo and
    // accent are still there after the new schema arrives.
    const db = new DatabaseSync(":memory:");
    await migrate(db, 3);

    db.prepare(
      `INSERT INTO settings (id, certificate_goal, current_focus, created_at, updated_at,
         pilot_name, flight_school, instructor_name, home_airport, aircraft_type,
         training_started_on, medical_expiry, why_note, photo, accent_color)
       VALUES ('profile', 'Private Pilot', 'Landings', 'then', 'then',
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "Ava", "Lakeside Aviation", "Dana", "KRHV", "C172S", "2026-01-12",
      "2028-03-31", "So my daughter sees it was possible.",
      "data:image/webp;base64,UklGRhIAAABXRUJQ", "sky",
    );

    await migrate(db, Number.MAX_SAFE_INTEGER);

    const profile = db.prepare("SELECT * FROM settings WHERE id = 'profile'").get() as Record<
      string,
      unknown
    >;
    expect(profile.pilot_name).toBe("Ava");
    expect(profile.flight_school).toBe("Lakeside Aviation");
    expect(profile.instructor_name).toBe("Dana");
    expect(profile.home_airport).toBe("KRHV");
    expect(profile.aircraft_type).toBe("C172S");
    expect(profile.training_started_on).toBe("2026-01-12");
    expect(profile.medical_expiry).toBe("2028-03-31");
    expect(profile.why_note).toBe("So my daughter sees it was possible.");
    expect(profile.photo).toBe("data:image/webp;base64,UklGRhIAAABXRUJQ");
    expect(profile.accent_color).toBe("sky");
    db.close();
  });

  it("is idempotent — running again changes nothing", async () => {
    const db = new DatabaseSync(":memory:");
    await migrate(db, Number.MAX_SAFE_INTEGER);
    await migrate(db, Number.MAX_SAFE_INTEGER);
    const rows = db.prepare("SELECT COUNT(*) c FROM schema_migrations").get() as { c: number };
    expect(rows.c).toBe(MIGRATIONS.length);
    db.close();
  });
});
