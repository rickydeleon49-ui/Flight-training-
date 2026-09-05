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
});
