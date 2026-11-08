// @vitest-environment jsdom
/** The "Add study pack" button: on the desktop app only, in the real Study Library. */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { useStatusAfterEffects, waitForReadyAfterEffects } from "@/testing/afterEffects";

const mocks = vi.hoisted(() => ({ native: false }));
let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
vi.mock("@/data/studyPack", async (original) => ({
  ...(await original<typeof import("@/data/studyPack")>()),
  studyPacksAvailable: () => mocks.native,
}));

const { StudyLibrary } = await import("./StudyLibrary");

beforeEach(async () => { db = await createNodeSqliteDatabase(); });
afterEach(() => { cleanup(); db.close(); });

function Probe() {
  useStatusAfterEffects(useAppData().status);
  return null;
}

async function openLibrary() {
  render(<AppDataProvider><MemoryRouter><Probe /><StudyLibrary /></MemoryRouter></AppDataProvider>);
  await waitForReadyAfterEffects();
  await screen.findByRole("heading", { name: "Study Library" });
}

it("hides Add study pack on the web build", async () => {
  mocks.native = false;
  await openLibrary();
  expect(screen.queryByRole("button", { name: "Add study pack" })).toBeNull();
});

it("shows one Add study pack button on the desktop app", async () => {
  mocks.native = true;
  await openLibrary();
  expect(screen.getAllByRole("button", { name: "Add study pack" })).toHaveLength(1);
});
