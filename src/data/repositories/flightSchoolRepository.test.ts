import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories, type Repositories } from "./index";
import type { FlightSchoolTrainingTrack } from "@/domain/types";

describe("flightSchoolRepository persistence", () => {
  let db: TestDatabase;
  let repositories: Repositories;

  beforeEach(async () => {
    db = await createNodeSqliteDatabase();
    repositories = createRepositories(db);
  });

  afterEach(() => db.close());

  it("creates a flight school with name only and sets defaults to null", async () => {
    const created = await repositories.flightSchools.create({
      name: "  Bay Flight Academy  ",
    });

    expect(created.id).toBeDefined();
    expect(created.name).toBe("Bay Flight Academy");
    expect(created.hourlyCostCents).toBeNull();
    expect(created.aircraftDescription).toBeNull();
    expect(created.trainingTrack).toBeNull();
    expect(created.availabilityDescription).toBeNull();
    expect(created.discoveryFlightReflection).toBeNull();
    expect(created.createdAt).toBeDefined();
    expect(created.updatedAt).toBe(created.createdAt);

    const fetched = await repositories.flightSchools.get(created.id);
    expect(fetched).toEqual(created);
  });

  it("creates a flight school with all optional values populated", async () => {
    const input = {
      name: "Sierra Aviation",
      hourlyCostCents: 21500,
      aircraftDescription: "C172S G1000 N12345, PA-28 Archer",
      trainingTrack: "Part 141" as FlightSchoolTrainingTrack,
      availabilityDescription: "7 days a week, 7am-9pm, high CFI availability",
      discoveryFlightReflection: "Amazing flight over the bay. Instructor was calm and patient.",
    };

    const created = await repositories.flightSchools.create(input);
    expect(created).toMatchObject({
      name: "Sierra Aviation",
      hourlyCostCents: 21500,
      aircraftDescription: "C172S G1000 N12345, PA-28 Archer",
      trainingTrack: "Part 141",
      availabilityDescription: "7 days a week, 7am-9pm, high CFI availability",
      discoveryFlightReflection: "Amazing flight over the bay. Instructor was calm and patient.",
    });

    const fetched = await repositories.flightSchools.get(created.id);
    expect(fetched).toEqual(created);
  });

  it("lists flight schools in case-insensitive alphabetical order by name, then id ascending", async () => {
    // Insert schools in arbitrary order
    const b = await repositories.flightSchools.create({ name: "bravo flight" });
    const a2 = await repositories.flightSchools.create({ name: "Alpha Aero" });
    const a1 = await repositories.flightSchools.create({ name: "alpha aero" });
    const c = await repositories.flightSchools.create({ name: "Charlie Flight Center" });

    const list = await repositories.flightSchools.list();
    const ids = list.map((s) => s.id);
    const names = list.map((s) => s.name);

    expect(list).toHaveLength(4);

    // "alpha aero" and "Alpha Aero" compare equally under NOCASE, so tie-break by id ASC
    const expectedAlphaIds = [a1.id, a2.id].sort((x, y) => x.localeCompare(y));
    const expectedFullIds = [...expectedAlphaIds, b.id, c.id];

    expect(names[0]?.toLowerCase()).toBe("alpha aero");
    expect(names[1]?.toLowerCase()).toBe("alpha aero");
    expect(ids).toEqual(expectedFullIds);

    expect(list[2]?.name).toBe("bravo flight");
    expect(list[3]?.name).toBe("Charlie Flight Center");
  });

  it("returns null when getting a missing record", async () => {
    const fetched = await repositories.flightSchools.get("non-existent-id");
    expect(fetched).toBeNull();
  });

  it("updates partial fields while preserving unspecified/undefined fields", async () => {
    const school = await repositories.flightSchools.create({
      name: "North Aero",
      hourlyCostCents: 18000,
      aircraftDescription: "C152",
      trainingTrack: "Part 61",
      availabilityDescription: "Weekends only",
      discoveryFlightReflection: "Great flight",
    });

    // Update only hourlyCostCents and trainingTrack, explicitly passing undefined for other properties
    await repositories.flightSchools.update(school.id, {
      name: undefined,
      hourlyCostCents: 19500,
      aircraftDescription: undefined,
      trainingTrack: "Part 141",
      availabilityDescription: undefined,
      discoveryFlightReflection: undefined,
    });

    const updated = await repositories.flightSchools.get(school.id);
    expect(updated).toMatchObject({
      id: school.id,
      name: "North Aero",
      hourlyCostCents: 19500,
      aircraftDescription: "C152",
      trainingTrack: "Part 141",
      availabilityDescription: "Weekends only",
      discoveryFlightReflection: "Great flight",
      createdAt: school.createdAt,
    });
    expect(updated?.updatedAt).toBeDefined();
  });

  it("clears optional fields with explicit null", async () => {
    const school = await repositories.flightSchools.create({
      name: "North Aero",
      hourlyCostCents: 18000,
      aircraftDescription: "C152",
      trainingTrack: "Part 61",
      availabilityDescription: "Weekends only",
      discoveryFlightReflection: "Great flight",
    });

    // Explicit null clears them
    await repositories.flightSchools.update(school.id, {
      hourlyCostCents: null,
      aircraftDescription: null,
      trainingTrack: null,
      availabilityDescription: null,
      discoveryFlightReflection: null,
    });

    const updated = await repositories.flightSchools.get(school.id);
    expect(updated).toMatchObject({
      id: school.id,
      name: "North Aero",
      hourlyCostCents: null,
      aircraftDescription: null,
      trainingTrack: null,
      availabilityDescription: null,
      discoveryFlightReflection: null,
      createdAt: school.createdAt,
    });
  });

  it("throws clear error when updating a missing or deleted record", async () => {
    await expect(
      repositories.flightSchools.update("non-existent-id", { name: "New Name" }),
    ).rejects.toThrow(/no longer exists/);

    const school = await repositories.flightSchools.create({ name: "Temporary School" });
    await repositories.flightSchools.remove(school.id);

    await expect(
      repositories.flightSchools.update(school.id, { name: "New Name" }),
    ).rejects.toThrow(/no longer exists/);
  });

  it("removes a single record by id without bulk deletion", async () => {
    const school1 = await repositories.flightSchools.create({ name: "School 1" });
    const school2 = await repositories.flightSchools.create({ name: "School 2" });

    await repositories.flightSchools.remove(school1.id);

    expect(await repositories.flightSchools.get(school1.id)).toBeNull();
    const remaining = await repositories.flightSchools.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(school2.id);
  });

  it("rejects invalid name inputs (empty, whitespace-only, too long, non-string)", async () => {
    await expect(repositories.flightSchools.create({ name: "" })).rejects.toThrow(
      /between 1 and 200 characters/,
    );
    await expect(repositories.flightSchools.create({ name: "   " })).rejects.toThrow(
      /between 1 and 200 characters/,
    );
    await expect(repositories.flightSchools.create({ name: "A".repeat(201) })).rejects.toThrow(
      /between 1 and 200 characters/,
    );
    // @ts-expect-error test runtime validation
    await expect(repositories.flightSchools.create({ name: null })).rejects.toThrow(
      /must be a string/,
    );
    // @ts-expect-error test runtime validation
    await expect(repositories.flightSchools.create({ name: 123 })).rejects.toThrow(
      /must be a string/,
    );

    const valid = await repositories.flightSchools.create({ name: "Valid" });
    await expect(repositories.flightSchools.update(valid.id, { name: "" })).rejects.toThrow(
      /between 1 and 200 characters/,
    );
  });

  it("rejects invalid cost inputs (negative, floating-point, unsafe integer, string)", async () => {
    await expect(
      repositories.flightSchools.create({ name: "School", hourlyCostCents: -1 }),
    ).rejects.toThrow(/non-negative safe integer/);

    await expect(
      repositories.flightSchools.create({ name: "School", hourlyCostCents: 150.5 }),
    ).rejects.toThrow(/non-negative safe integer/);

    await expect(
      repositories.flightSchools.create({
        name: "School",
        // @ts-expect-error test runtime validation
        hourlyCostCents: "15000",
      }),
    ).rejects.toThrow(/non-negative safe integer/);

    await expect(
      repositories.flightSchools.create({
        name: "School",
        hourlyCostCents: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).rejects.toThrow(/non-negative safe integer/);
  });

  it("rejects invalid text inputs exceeding max lengths", async () => {
    await expect(
      repositories.flightSchools.create({
        name: "School",
        aircraftDescription: "A".repeat(2001),
      }),
    ).rejects.toThrow(/Aircraft description exceeds maximum length of 2000/);

    await expect(
      repositories.flightSchools.create({
        name: "School",
        availabilityDescription: "A".repeat(2001),
      }),
    ).rejects.toThrow(/Availability description exceeds maximum length of 2000/);

    await expect(
      repositories.flightSchools.create({
        name: "School",
        discoveryFlightReflection: "A".repeat(20001),
      }),
    ).rejects.toThrow(/Discovery flight reflection exceeds maximum length of 20000/);
  });

  it("rejects invalid trainingTrack inputs", async () => {
    await expect(
      repositories.flightSchools.create({
        name: "School",
        // @ts-expect-error test runtime validation
        trainingTrack: "Part 91",
      }),
    ).rejects.toThrow(/Training track must be 'Part 61', 'Part 141', 'not sure', or null/);

    // Valid tracks
    for (const track of ["Part 61", "Part 141", "not sure"] as const) {
      const s = await repositories.flightSchools.create({ name: `School ${track}`, trainingTrack: track });
      expect(s.trainingTrack).toBe(track);
    }
  });

  it("guarantees id and createdAt are immutable across updates", async () => {
    const school = await repositories.flightSchools.create({
      name: "Original Name",
      hourlyCostCents: 10000,
    });

    const originalCreatedAt = school.createdAt;
    const originalId = school.id;

    // Explicitly attempt id and createdAt override using a narrow runtime-invalid cast
    await repositories.flightSchools.update(
      school.id,
      {
        name: "Renamed School",
        hourlyCostCents: 12000,
        id: "hacked-id",
        createdAt: "2099-01-01T00:00:00.000Z",
      } as unknown as Parameters<typeof repositories.flightSchools.update>[1],
    );

    const updated = await repositories.flightSchools.get(school.id);
    expect(updated?.id).toBe(originalId);
    expect(updated?.name).toBe("Renamed School");
    expect(updated?.hourlyCostCents).toBe(12000);
    expect(updated?.createdAt).toBe(originalCreatedAt);

    const bypassed = await repositories.flightSchools.get("hacked-id");
    expect(bypassed).toBeNull();
  });

  it("persists across closing and reopening a file-backed SQLite database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flight-school-test-"));
    const file = join(directory, "test-flight-deck.db");

    try {
      const firstDb = await createNodeSqliteDatabase(file);
      const firstRepos = createRepositories(firstDb);

      const created = await firstRepos.flightSchools.create({
        name: "Pacific Skies Flight School",
        hourlyCostCents: 22000,
        aircraftDescription: "Piper Archer III, Diamond DA40",
        trainingTrack: "Part 61",
        availabilityDescription: "Evenings and weekends",
        discoveryFlightReflection: "Incredible view of coastline. Preflight checklist was thorough.",
      });

      firstDb.close();

      // Reopen same database file
      const reopenedDb = await createNodeSqliteDatabase(file);
      const reopenedRepos = createRepositories(reopenedDb);

      const retrieved = await reopenedRepos.flightSchools.get(created.id);
      reopenedDb.close();

      expect(retrieved).toEqual(created);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
