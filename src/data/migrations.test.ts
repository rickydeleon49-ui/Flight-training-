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

  describe("migration 21 (flight_schools)", () => {
    it("upgrades a version-20 database preserving personalized profile school text, creates empty flight_schools, and enforces column constraints", async () => {
      const db = new DatabaseSync(":memory:");

      // Set up a database at schema version 20
      await migrate(db, 20);

      // Verify flight_schools does not exist yet at version 20
      const tablesAt20 = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='flight_schools'")
        .all();
      expect(tablesAt20).toHaveLength(0);

      // Populate a personalized profile record with existing flight_school text
      db.prepare(
        `INSERT INTO settings (id, certificate_goal, current_focus, created_at, updated_at,
           pilot_name, flight_school, instructor_name, home_airport, aircraft_type,
           training_started_on, medical_expiry, why_note, photo, accent_color)
         VALUES ('profile', 'Private Pilot', 'Cross Country', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "Amelia", "Sierra Charlie Aviation", "John", "KSDL", "C172", "2026-02-01",
        "2028-05-31", "Pass checkride on first try.",
        "data:image/webp;base64,mockphoto", "sage",
      );

      // Run migration 21 (upgrade to current ceiling)
      await migrate(db, Number.MAX_SAFE_INTEGER);

      // 1. Existing profile.flight_school text is unmodified
      const profile = db.prepare("SELECT * FROM settings WHERE id = 'profile'").get() as Record<string, unknown>;
      expect(profile.pilot_name).toBe("Amelia");
      expect(profile.flight_school).toBe("Sierra Charlie Aviation");
      expect(profile.instructor_name).toBe("John");
      expect(profile.home_airport).toBe("KSDL");
      expect(profile.why_note).toBe("Pass checkride on first try.");

      // 2. flight_schools table exists and starts empty (no seeding, no profile conversion)
      const schoolCount = db.prepare("SELECT COUNT(*) as count FROM flight_schools").get() as { count: number };
      expect(schoolCount.count).toBe(0);

      // 3. Optional fields allow NULL and valid insert succeeds
      db.prepare(
        `INSERT INTO flight_schools (
           id, name, hourly_cost_cents, aircraft_description, training_track,
           availability_description, discovery_flight_reflection, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("sch_1", "Test Flight Academy", null, null, null, null, null, "2026-10-24T00:00:00.000Z", "2026-10-24T00:00:00.000Z");

      const inserted = db.prepare("SELECT * FROM flight_schools WHERE id = 'sch_1'").get() as Record<string, unknown>;
      expect(inserted.name).toBe("Test Flight Academy");
      expect(inserted.hourly_cost_cents).toBeNull();
      expect(inserted.aircraft_description).toBeNull();
      expect(inserted.training_track).toBeNull();
      expect(inserted.availability_description).toBeNull();
      expect(inserted.discovery_flight_reflection).toBeNull();

      // Valid insert with maximum safe integer for hourly_cost_cents and valid values
      db.prepare(
        `INSERT INTO flight_schools (
           id, name, hourly_cost_cents, aircraft_description, training_track,
           availability_description, discovery_flight_reflection, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("sch_max", "Valid Max Academy", 9007199254740991, "Fleet of DA40", "Part 141", "Weekends", "Great flight", "2026-10-24T00:00:00.000Z", "2026-10-24T00:00:00.000Z");

      // Valid insert with training tracks
      for (const track of ["Part 61", "Part 141", "not sure"]) {
        db.prepare(
          `INSERT INTO flight_schools (id, name, training_track, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(`sch_${track}`, `Academy ${track}`, track, "2026-10-24T00:00:00.000Z", "2026-10-24T00:00:00.000Z");
      }

      // 4. Invalid name is rejected (empty string or whitespace only or > 200 chars)
      expect(() => {
        db.prepare(
          `INSERT INTO flight_schools (id, name, created_at, updated_at)
           VALUES ('bad_name_1', '', '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z')`,
        ).run();
      }).toThrow();

      expect(() => {
        db.prepare(
          `INSERT INTO flight_schools (id, name, created_at, updated_at)
           VALUES ('bad_name_2', '   ', '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z')`,
        ).run();
      }).toThrow();

      expect(() => {
        db.prepare(
          `INSERT INTO flight_schools (id, name, created_at, updated_at)
           VALUES ('bad_name_3', ?, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z')`,
        ).run("A".repeat(201));
      }).toThrow();

      // 5. Invalid training_track is rejected
      expect(() => {
        db.prepare(
          `INSERT INTO flight_schools (id, name, training_track, created_at, updated_at)
           VALUES ('bad_track', 'School', 'Part 121', '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z')`,
        ).run();
      }).toThrow();

      // 6. Invalid hourly_cost_cents is rejected (negative, float, or > 9007199254740991)
      expect(() => {
        db.prepare(
          `INSERT INTO flight_schools (id, name, hourly_cost_cents, created_at, updated_at)
           VALUES ('bad_cost_neg', 'School', -1, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z')`,
        ).run();
      }).toThrow();

      expect(() => {
        db.prepare(
          `INSERT INTO flight_schools (id, name, hourly_cost_cents, created_at, updated_at)
           VALUES ('bad_cost_float', 'School', 150.50, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z')`,
        ).run();
      }).toThrow();

      expect(() => {
        db.prepare(
          `INSERT INTO flight_schools (id, name, hourly_cost_cents, created_at, updated_at)
           VALUES ('bad_cost_overflow', 'School', 9007199254740992, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z')`,
        ).run();
      }).toThrow();

      // 7. Invalid text lengths are rejected
      // aircraft_description > 2000
      expect(() => {
        db.prepare(
          `INSERT INTO flight_schools (id, name, aircraft_description, created_at, updated_at)
           VALUES ('bad_air', 'School', ?, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z')`,
        ).run("x".repeat(2001));
      }).toThrow();

      // availability_description > 2000
      expect(() => {
        db.prepare(
          `INSERT INTO flight_schools (id, name, availability_description, created_at, updated_at)
           VALUES ('bad_avail', 'School', ?, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z')`,
        ).run("x".repeat(2001));
      }).toThrow();

      // discovery_flight_reflection > 20000
      expect(() => {
        db.prepare(
          `INSERT INTO flight_schools (id, name, discovery_flight_reflection, created_at, updated_at)
           VALUES ('bad_disc', 'School', ?, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z')`,
        ).run("x".repeat(20001));
      }).toThrow();

      db.close();
    });
  });
});
