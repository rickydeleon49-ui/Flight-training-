// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { Settings } from "./Settings";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
vi.mock("@/services/documents", async (original) => ({
  ...(await original<typeof import("@/services/documents")>()),
  canHandleFiles: () => true,
  checkLibrary: async () => ({ missingMaterials: [], unlinkedFiles: [], totalMaterials: 3, totalFiles: 3 }),
}));
function Ready() { return useAppData().status === "ready" ? <Settings /> : null; }
beforeEach(async () => { localStorage.clear(); db = await createNodeSqliteDatabase(); });
afterEach(() => { cleanup(); db.close(); localStorage.clear(); vi.restoreAllMocks(); });

it("Check library shows its result under the button, scrolls it into view and moves focus to it", async () => {
  const scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled;
  render(<AppDataProvider><MemoryRouter initialEntries={["/settings"]}><Ready /></MemoryRouter></AppDataProvider>);
  await screen.findByRole("heading", { name: "About you" });
  fireEvent.click(await screen.findByRole("button", { name: "Check library" }));
  const note = await screen.findByText("Library check complete.");
  const result = note.closest("[data-library-result]") as HTMLElement;
  expect(result).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check library" }).parentElement!.nextElementSibling).toBe(result);
  await waitFor(() => expect(document.activeElement).toBe(result));
  expect(scrolled).toHaveBeenCalled();
  expect(result.textContent).toContain("Checked 3 materials and 3 stored files.");
});
