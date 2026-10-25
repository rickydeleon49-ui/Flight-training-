import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "../testing/nodeSqliteDb";
import { createRepositories, type Repositories } from "./index";

describe("journal flight log persistence", () => {
  let db: TestDatabase;
  let repositories: Repositories;

  beforeEach(async () => {
    db = await createNodeSqliteDatabase();
    repositories = createRepositories(db);
  });

  afterEach(() => db.close());

  it("stores and updates training-flight details without calculating categories", async () => {
    const created = await repositories.journal.create({
      date: "2026-09-05",
      title: "Pattern work",
      aircraftType: "Cessna 172S",
      aircraftId: "N12345",
      departureAirport: "KPAE",
      arrivalAirport: "KPAE",
      instructorName: "Taylor Morgan",
      totalTime: 1.2,
      dualReceived: 1.2,
      picTime: 1.2,
      dayLandings: 6,
    });

    expect((await repositories.journal.list())[0]).toMatchObject({
      aircraftType: "Cessna 172S",
      aircraftId: "N12345",
      totalTime: 1.2,
      dualReceived: 1.2,
      picTime: 1.2,
      dayLandings: 6,
    });

    await repositories.journal.update(created.id, { nightTime: 0.4, nightLandings: 2 });
    expect((await repositories.journal.list())[0]).toMatchObject({
      totalTime: 1.2,
      nightTime: 0.4,
      nightLandings: 2,
    });
  });

  it("creates a date-only entry with default schoolName as null", async () => {
    const created = await repositories.journal.create({
      date: "2026-10-01",
    });

    expect(created.schoolName).toBeNull();
    const fetched = await repositories.journal.get(created.id);
    expect(fetched?.schoolName).toBeNull();

    const list = await repositories.journal.list();
    const found = list.find((e) => e.id === created.id);
    expect(found?.schoolName).toBeNull();
  });

  it("creates an entry with explicit schoolName snapshot and supports roundtrip get and list", async () => {
    const created = await repositories.journal.create({
      date: "2026-10-02",
      title: "Cross Country",
      schoolName: "  Rainier Flight Service  ",
    });

    expect(created.schoolName).toBe("Rainier Flight Service");

    const fetched = await repositories.journal.get(created.id);
    expect(fetched?.schoolName).toBe("Rainier Flight Service");

    const list = await repositories.journal.list();
    const found = list.find((e) => e.id === created.id);
    expect(found?.schoolName).toBe("Rainier Flight Service");
  });

  it("normalizes empty or whitespace-only schoolName to null on create", async () => {
    const entry1 = await repositories.journal.create({
      date: "2026-10-03",
      schoolName: null,
    });
    expect(entry1.schoolName).toBeNull();

    const entry2 = await repositories.journal.create({
      date: "2026-10-04",
      schoolName: "   \t \n ",
    });
    expect(entry2.schoolName).toBeNull();

    const fetched2 = await repositories.journal.get(entry2.id);
    expect(fetched2?.schoolName).toBeNull();
  });

  it("preserves schoolName snapshot when omitted or explicit undefined on update", async () => {
    const created = await repositories.journal.create({
      date: "2026-10-05",
      title: "Stage Check Prep",
      schoolName: "Cascade Aviation",
      totalTime: 1.5,
    });

    // Update with omitted schoolName
    await repositories.journal.update(created.id, {
      totalTime: 1.8,
    });
    let fetched = await repositories.journal.get(created.id);
    expect(fetched?.schoolName).toBe("Cascade Aviation");
    expect(fetched?.totalTime).toBe(1.8);

    // Update with explicit undefined
    await repositories.journal.update(created.id, {
      schoolName: undefined,
      mission: "Maneuvers",
    });
    fetched = await repositories.journal.get(created.id);
    expect(fetched?.schoolName).toBe("Cascade Aviation");
    expect(fetched?.mission).toBe("Maneuvers");
  });

  it("clears schoolName snapshot when updated with explicit null or whitespace", async () => {
    const created = await repositories.journal.create({
      date: "2026-10-06",
      schoolName: "Cascade Aviation",
    });

    // Clear with whitespace string
    await repositories.journal.update(created.id, {
      schoolName: "    ",
    });
    let fetched = await repositories.journal.get(created.id);
    expect(fetched?.schoolName).toBeNull();

    // Re-set school name
    await repositories.journal.update(created.id, {
      schoolName: "Sound Flight",
    });
    fetched = await repositories.journal.get(created.id);
    expect(fetched?.schoolName).toBe("Sound Flight");

    // Clear with explicit null
    await repositories.journal.update(created.id, {
      schoolName: null,
    });
    fetched = await repositories.journal.get(created.id);
    expect(fetched?.schoolName).toBeNull();
  });

  it("rejects invalid types and oversize values on create without writing row", async () => {
    const badTypeInput = {
      date: "2026-10-07",
      schoolName: 12345 as unknown as string,
    };
    await expect(repositories.journal.create(badTypeInput)).rejects.toThrow(
      "School name must be a string or null.",
    );

    const oversizeInput = {
      date: "2026-10-07",
      schoolName: "A".repeat(201),
    };
    await expect(repositories.journal.create(oversizeInput)).rejects.toThrow(
      "School name exceeds maximum length of 200 characters.",
    );

    // Exact 200 characters succeeds
    const exact200Input = {
      date: "2026-10-07",
      schoolName: "A".repeat(200),
    };
    const createdExact = await repositories.journal.create(exact200Input);
    expect(createdExact.schoolName).toBe("A".repeat(200));
    const fetchedExact = await repositories.journal.get(createdExact.id);
    expect(fetchedExact?.schoolName).toBe("A".repeat(200));

    const list = await repositories.journal.list();
    expect(list.find((e) => e.date === "2026-10-07" && e.schoolName === "A".repeat(200))).toBeDefined();
  });

  it("rejects invalid types and oversize values on update without overwriting prior row", async () => {
    const created = await repositories.journal.create({
      date: "2026-10-08",
      title: "Night Flight",
      schoolName: "Galvin Flying",
    });

    await expect(
      repositories.journal.update(created.id, {
        schoolName: { bad: "type" } as unknown as string,
      }),
    ).rejects.toThrow("School name must be a string or null.");

    await expect(
      repositories.journal.update(created.id, {
        schoolName: "B".repeat(201),
      }),
    ).rejects.toThrow("School name exceeds maximum length of 200 characters.");

    // Verify row was not overwritten or corrupted
    let fetched = await repositories.journal.get(created.id);
    expect(fetched?.schoolName).toBe("Galvin Flying");
    expect(fetched?.title).toBe("Night Flight");

    // Exact 200 characters succeeds on update
    await repositories.journal.update(created.id, {
      schoolName: "B".repeat(200),
    });
    fetched = await repositories.journal.get(created.id);
    expect(fetched?.schoolName).toBe("B".repeat(200));
  });

  it("preserves unrelated fields and linked materials when schoolName is updated", async () => {
    const mat1 = await repositories.documents.create({ title: "Checkride Prep Material 1" });
    const mat2 = await repositories.documents.create({ title: "Checkride Prep Material 2" });

    const created = await repositories.journal.create({
      date: "2026-10-09",
      title: "Solo Cross Country",
      aircraftType: "PA-28",
      aircraftId: "N54321",
      departureAirport: "KPAE",
      arrivalAirport: "KBVS",
      instructorName: "Sam Instructor",
      totalTime: 2.1,
      soloTime: 2.1,
      picTime: 2.1,
      crossCountryTime: 2.1,
      dayLandings: 3,
      mission: "First solo cross country",
      practiced: "Pilotage & dead reckoning",
      wentWell: "Checkpoints were spot on",
      wasDifficult: "Radio frequency change timing",
      instructorFeedback: "Great job maintaining altitude",
      questionsForNextTime: "How to handle airspace transition?",
      confidence: 4,
      schoolName: "Initial School",
      materialIds: [mat1.id, mat2.id],
    });

    await repositories.journal.update(created.id, {
      schoolName: "Updated School",
    });

    const fetched = await repositories.journal.get(created.id);
    expect(fetched).toMatchObject({
      id: created.id,
      date: "2026-10-09",
      title: "Solo Cross Country",
      aircraftType: "PA-28",
      aircraftId: "N54321",
      departureAirport: "KPAE",
      arrivalAirport: "KBVS",
      instructorName: "Sam Instructor",
      totalTime: 2.1,
      soloTime: 2.1,
      picTime: 2.1,
      crossCountryTime: 2.1,
      dayLandings: 3,
      mission: "First solo cross country",
      practiced: "Pilotage & dead reckoning",
      wentWell: "Checkpoints were spot on",
      wasDifficult: "Radio frequency change timing",
      instructorFeedback: "Great job maintaining altitude",
      questionsForNextTime: "How to handle airspace transition?",
      confidence: 4,
      schoolName: "Updated School",
    });
    expect([...(fetched?.materialIds ?? [])].sort()).toEqual([mat1.id, mat2.id].sort());
  });

  it("preserves schoolName across closing and reopening file-backed db", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "flightlog-journal-test-"));
    const dbPath = join(tempDir, "test.db");

    try {
      const fileDb1 = await createNodeSqliteDatabase(dbPath);
      const repos1 = createRepositories(fileDb1);

      const created = await repos1.journal.create({
        date: "2026-10-10",
        title: "Hood Work",
        schoolName: "Aero Academy",
      });
      fileDb1.close();

      const fileDb2 = await createNodeSqliteDatabase(dbPath);
      const repos2 = createRepositories(fileDb2);

      const fetched = await repos2.journal.get(created.id);
      expect(fetched?.schoolName).toBe("Aero Academy");
      expect(fetched?.title).toBe("Hood Work");

      const list = await repos2.journal.list();
      expect(list.find((e) => e.id === created.id)?.schoolName).toBe("Aero Academy");

      fileDb2.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("comparison school rename and removal leaves journal snapshot and flight record unchanged", async () => {
    // 1. Create a flight school in flight_schools comparison repository
    const school = await repositories.flightSchools.create({
      name: "Summit Aviation",
      hourlyCostCents: 19500,
    });

    // 2. Create a journal entry snapshotting that school name
    const journalEntry = await repositories.journal.create({
      date: "2026-10-11",
      title: "Slow flight",
      schoolName: "Summit Aviation",
      totalTime: 1.4,
      dualReceived: 1.4,
    });

    // 3. Rename the flight school record
    await repositories.flightSchools.update(school.id, {
      name: "Summit Flight College",
    });

    // Verify journal snapshot is completely unaffected by rename
    let fetchedJournal = await repositories.journal.get(journalEntry.id);
    expect(fetchedJournal?.schoolName).toBe("Summit Aviation");
    expect(fetchedJournal?.totalTime).toBe(1.4);

    // 4. Delete the flight school record
    await repositories.flightSchools.remove(school.id);
    const fetchedSchool = await repositories.flightSchools.get(school.id);
    expect(fetchedSchool).toBeNull();

    // Verify journal snapshot and flight record remain intact (no FK cascade or nullification)
    fetchedJournal = await repositories.journal.get(journalEntry.id);
    expect(fetchedJournal?.schoolName).toBe("Summit Aviation");
    expect(fetchedJournal?.totalTime).toBe(1.4);
    expect(fetchedJournal?.title).toBe("Slow flight");
  });
});
