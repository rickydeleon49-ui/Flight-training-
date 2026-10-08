// @vitest-environment jsdom
/**
 * M2-4 / C2 (C2SRC-R1): the published data revision advances with each
 * snapshot that wins publication and never for an obsolete load, so views
 * keyed on it cannot be rolled back to older data.
 */
import { createElement as h } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";

import { AppDataProvider, useAppData } from "./AppDataContext";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}

beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  await createRepositories(db).app.set("airline_starter_pack", "skipped-for-test");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  db.close();
});

it("advances once per published snapshot, including a completed mutation", async () => {
  render(h(AppDataProvider, null, h(Probe)));
  await waitFor(() => expect(context.status).toBe("ready"));
  const ready = context.dataRevision;
  expect(ready).toBeGreaterThan(0);
  await act(async () => {
    await context.mutate((repos) => repos.app.set("unrelated", "value"));
  });
  expect(context.dataRevision).toBe(ready + 1);
  await act(async () => {
    await context.refresh();
  });
  expect(context.dataRevision).toBe(ready + 2);
});

it("an obsolete refresh that finishes last neither publishes its data nor advances the revision", async () => {
  render(h(AppDataProvider, null, h(Probe)));
  await waitFor(() => expect(context.status).toBe("ready"));
  const repositories = context.repositories!;
  const real = repositories.documents.list.bind(repositories.documents);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  vi.spyOn(repositories.documents, "list").mockImplementation(async () => {
    const materials = await real();
    if (first) {
      first = false;
      await held;
    }
    return materials;
  });
  const before = context.dataRevision;
  let older!: Promise<void>;
  act(() => {
    older = context.refresh();
  });
  await createRepositories(db).documents.create({ id: "m1", title: "Weather basics", topic: "general" as never, priority: "later" as never });
  await act(async () => {
    await context.refresh();
  });
  expect(context.dataRevision).toBe(before + 1);
  expect(context.data.materials.map((m) => m.id)).toEqual(["m1"]);
  await act(async () => {
    release();
    await older;
  });
  expect(context.dataRevision).toBe(before + 1);
  expect(context.data.materials.map((m) => m.id)).toEqual(["m1"]);
});
