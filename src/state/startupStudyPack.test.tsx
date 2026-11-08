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

function Ready() {
  const { status, lastError } = useAppData();
  return status === "ready" ? <><p>ready</p>{lastError ? <p>{lastError}</p> : null}</> : null;
}
beforeEach(async () => { vi.resetAllMocks(); localStorage.clear(); db = await createNodeSqliteDatabase(); });
afterEach(() => { cleanup(); db.close(); localStorage.clear(); });

it("reconciles unfinished study packs once after the database opens, only on the desktop app", async () => {
  mocks.native = true;
  mocks.reconcile.mockResolvedValue(undefined);
  render(<AppDataProvider><MemoryRouter><Ready /></MemoryRouter></AppDataProvider>);
  await screen.findByText("ready");
  expect(mocks.reconcile).toHaveBeenCalledOnce();
  expect(screen.queryByText(/didn't finish adding/)).toBeNull();
});

it("runs the reconcile before the library is created", async () => {
  mocks.native = true;
  let starterPresentDuringReconcile: unknown = "unset";
  mocks.reconcile.mockImplementation(async () => {
    const rows = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM study_materials");
    starterPresentDuringReconcile = rows[0]?.n;
  });
  render(<AppDataProvider><MemoryRouter><Ready /></MemoryRouter></AppDataProvider>);
  await screen.findByText("ready");
  expect(starterPresentDuringReconcile).toBe(0);
});

it("a failed reconcile never blocks the app but tells her plainly, and the web build never calls it", async () => {
  mocks.native = true;
  mocks.reconcile.mockRejectedValue("busy");
  const first = render(<AppDataProvider><MemoryRouter><Ready /></MemoryRouter></AppDataProvider>);
  await screen.findByText("ready");
  expect(await screen.findByText(/didn't finish adding/)).toBeTruthy();
  first.unmount();
  mocks.reconcile.mockClear();
  mocks.native = false;
  render(<AppDataProvider><MemoryRouter><Ready /></MemoryRouter></AppDataProvider>);
  await screen.findByText("ready");
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
