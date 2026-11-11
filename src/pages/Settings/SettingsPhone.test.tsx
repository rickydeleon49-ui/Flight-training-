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
vi.mock("@/services/gemini", async (original) => ({
  ...await original<typeof import("@/services/gemini")>(),
  geminiAvailable: () => true,
}));
vi.mock("@/services/platform", async (original) => ({
  ...await original<typeof import("@/services/platform")>(),
  isIOS: () => mocks.phone,
  isMacOS: () => !mocks.phone,
  deviceCan: () => ({ geminiKey: true, getStudyMaterial: mocks.phone, savePhoneWork: mocks.phone, sendPhoneProgress: mocks.phone, generate: !mocks.phone, pdfKit: !mocks.phone, sendToIphone: !mocks.phone, getPhoneProgress: !mocks.phone }),
}));
function Ready() { return useAppData().status === "ready" ? <Settings /> : null; }
beforeEach(async () => { localStorage.clear(); db = await createNodeSqliteDatabase(); });
afterEach(() => { vi.restoreAllMocks(); cleanup(); db.close(); localStorage.clear(); });

it.each([true, false])("renders only the appropriate Settings cards (phone=%s)", async (phone) => {
  mocks.phone = phone;
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
  render(<AppDataProvider><MemoryRouter><Ready /></MemoryRouter></AppDataProvider>);
  await waitFor(() => expect(screen.getByRole("heading", { name: "About you" })).toBeTruthy());
  expect(Boolean(screen.queryByRole("heading", { name: "Get my study material" }))).toBe(phone);
  (document.getElementById("settings-backups") as HTMLDetailsElement).open = true;
  expect(Boolean(screen.queryByRole("heading", { name: "Your data" }))).toBe(!phone);
  expect(Boolean(screen.queryByRole("heading", { name: "Start fresh" }))).toBe(phone);
  expect(screen.queryByRole("heading", { name: "AI helper" })).toBeTruthy();
  const card = document.getElementById("ai-provider")?.closest(".card")?.textContent ?? "";
  if (phone) {
    expect(card).toMatch(/Keychain/);
    expect(card).toMatch(/this iPhone/);
    expect(card).not.toMatch(/this computer|Application Support|desktop application/);
  } else {
    expect(card).toMatch(/Mac’s Keychain/);
  }
  expect(Boolean(screen.queryByRole("heading", { name: "Send my progress to the Mac" }))).toBe(phone);
  expect(Boolean(screen.queryByRole("heading", { name: "Send to my iPhone" }))).toBe(!phone);
  expect(Boolean(screen.queryByRole("heading", { name: "Get progress from my iPhone" }))).toBe(!phone);
  expect(document.querySelector(".stack.stack--5 > .card h2")?.textContent).toBe("AI helper");
  if (phone) {
    expect(document.body.textContent).not.toMatch(/sync|manifest|archive/i);
    for (const name of ["Save complete backup", "Restore backup", "Open folder"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  }
});
