// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { Settings } from "./Settings";

const mocks = vi.hoisted(() => ({ phone: false }));
let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
vi.mock("@/services/platform", async (original) => ({
  ...await original<typeof import("@/services/platform")>(),
  deviceCan: () => ({ getStudyMaterial: mocks.phone, generate: !mocks.phone, sendToIphone: false }),
}));
function Ready() { return useAppData().status === "ready" ? <Settings /> : null; }
beforeEach(async () => { localStorage.clear(); db = await createNodeSqliteDatabase(); });
afterEach(() => { cleanup(); db.close(); localStorage.clear(); });

it.each([true, false])("renders only the appropriate Settings cards (phone=%s)", async (phone) => {
  mocks.phone = phone;
  render(<AppDataProvider><MemoryRouter><Ready /></MemoryRouter></AppDataProvider>);
  await waitFor(() => expect(screen.getByRole("heading", { name: "About you" })).toBeTruthy());
  expect(Boolean(screen.queryByRole("heading", { name: "Get my study material" }))).toBe(phone);
  expect(Boolean(screen.queryByRole("heading", { name: "Your data" }))).toBe(!phone);
  expect(Boolean(screen.queryByRole("heading", { name: "AI provider" }))).toBe(!phone);
  expect(screen.queryByRole("heading", { name: "Send to my iPhone" })).toBeNull();
  if (phone) {
    for (const name of ["Save complete backup", "Restore backup", "Open folder"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  }
});
