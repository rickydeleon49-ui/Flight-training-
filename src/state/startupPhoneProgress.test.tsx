// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

const mocks = vi.hoisted(() => ({ ios: false, prepare: vi.fn(), baseline: vi.fn() }));
let db: TestDatabase;
vi.mock("@/data", async (original) => ({
  ...await original<typeof import("@/data")>(),
  getDatabase: () => Promise.resolve(db),
  isTauri: () => true,
}));
vi.mock("@/services/platform", async (original) => ({
  ...await original<typeof import("@/services/platform")>(),
  isIOS: () => mocks.ios,
}));
vi.mock("@/services/phoneProgress", async (original) => ({
  ...await original<typeof import("@/services/phoneProgress")>(), preparePhoneProgress: mocks.prepare,
}));
vi.mock("@/services/backups", async (original) => ({
  ...await original<typeof import("@/services/backups")>(), recordFreshPhoneBaseline: mocks.baseline,
}));

function Ready() { return useAppData().status === "ready" ? <p>ready</p> : null; }
beforeEach(async () => { vi.resetAllMocks(); localStorage.clear(); db = await createNodeSqliteDatabase(); });
afterEach(() => { cleanup(); db.close(); localStorage.clear(); });

it.each([true, false])("prepares the phone's progress once, only on iOS (ios=%s)", async (ios) => {
  mocks.ios = ios;
  render(<AppDataProvider><MemoryRouter><Ready /></MemoryRouter></AppDataProvider>);
  await screen.findByText("ready");
  if (ios) await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  else await new Promise((r) => setTimeout(r, 50));
  expect(mocks.prepare).toHaveBeenCalledTimes(ios ? 1 : 0);
  expect(mocks.baseline).toHaveBeenCalledTimes(ios ? 1 : 0);
});
