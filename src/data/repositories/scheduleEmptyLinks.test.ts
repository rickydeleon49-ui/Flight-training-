import { expect, it, vi } from "vitest";
import { createNodeSqliteDatabase } from "../testing/nodeSqliteDb";
import { createRepositories } from "./index";

it("new lessons with omitted or empty materials keep identical rows without a link transaction", async () => {
  const db = await createNodeSqliteDatabase();
  try {
    const repos = createRepositories(db);
    const links = vi.spyOn(db, "replaceMaterialLinksAtomically");
    for (const materialIds of [undefined, []]) {
      const event = await repos.schedule.create({ title: "Fictional lesson", date: "2026-10-30", materialIds });
      expect((await repos.schedule.list()).find((row) => row.id === event.id)).toEqual(event);
      expect(event.materialIds).toEqual([]);
    }
    expect(links).not.toHaveBeenCalled();
    const material = await repos.documents.create({ title: "Fictional material" });
    const linked = await repos.schedule.create({ title: "Linked lesson", date: "2026-10-30", materialIds: [material.id] });
    expect(links).toHaveBeenCalledExactlyOnceWith("schedule", linked.id, [material.id]);
    expect((await repos.schedule.list()).find((row) => row.id === linked.id)).toEqual(linked);
    expect(await db.select("SELECT * FROM event_materials")).toHaveLength(1);
  } finally {
    db.close();
  }
});
