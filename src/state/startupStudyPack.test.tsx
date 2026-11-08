// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

const mocks = vi.hoisted(() => ({ native: true, reconcile: vi.fn() }));
let db: TestDatabase;
vi.mock("@/data", async (original) => ({
  ...await original<typeof import("@/data")>(),
  getDatabase: () => Promise.resolve(db),
  isTauri: () => mocks.native,
}));
vi.mock("@/data/studyPack", async (original) => ({
  ...await original<typeof import("@/data/studyPack")>(), reconcileStudyPacks: mocks.reconcile,
}));
vi.mock("@/services/backups", async (original) => ({
  ...await original<typeof import("@/services/backups")>(), recordFreshPhoneBaseline: vi.fn(),
}));

function Ready() { return useAppData().status === "ready" ? <p>ready</p> : null; }
beforeEach(async () => { vi.resetAllMocks(); localStorage.clear(); db = await createNodeSqliteDatabase(); });
afterEach(() => { cleanup(); db.close(); localStorage.clear(); });

it("reconciles unfinished study packs once after the database opens, only on the desktop app", async () => {
  mocks.native = true;
  mocks.reconcile.mockResolvedValue(undefined);
  render(<AppDataProvider><MemoryRouter><Ready /></MemoryRouter></AppDataProvider>);
  await screen.findByText("ready");
  expect(mocks.reconcile).toHaveBeenCalledOnce();
});

it("a failed reconcile never blocks the app, and the web build never calls it", async () => {
  mocks.native = true;
  mocks.reconcile.mockRejectedValue("busy");
  const first = render(<AppDataProvider><MemoryRouter><Ready /></MemoryRouter></AppDataProvider>);
  await screen.findByText("ready");
  first.unmount();
  mocks.reconcile.mockClear();
  mocks.native = false;
  render(<AppDataProvider><MemoryRouter><Ready /></MemoryRouter></AppDataProvider>);
  await screen.findByText("ready");
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
