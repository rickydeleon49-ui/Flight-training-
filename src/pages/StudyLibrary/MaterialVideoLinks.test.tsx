// @vitest-environment jsdom
import { type ContextType } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDataContext } from "@/state/AppDataContext";
import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { MaterialVideoLinks } from "./MaterialVideoLinks";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@/data";
vi.mock("@/data", () => ({ isTauri: vi.fn(() => false) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
let db: TestDatabase;
let repositories: Repositories;
function show() {
  render(<AppDataContext.Provider value={{ repositories } as ContextType<typeof AppDataContext>}><MaterialVideoLinks materialId="section" /></AppDataContext.Provider>);
}
async function add(name = "Helpful lesson") {
  fireEvent.change(screen.getByPlaceholderText("Paste a YouTube or video link"), { target: { value: "https://youtube.com/watch?v=synthetic" } });
  fireEvent.change(screen.getAllByLabelText("Name (optional)")[0]!, { target: { value: name } });
  fireEvent.submit(screen.getByRole("form", { name: "Add a video link" }));
  return screen.findByRole("link", { name: name || "youtube.com/watch" });
}
beforeEach(async () => {
  vi.clearAllMocks(); vi.mocked(isTauri).mockReturnValue(false);
  db = await createNodeSqliteDatabase(); repositories = createRepositories(db);
  await repositories.documents.create({ id: "section", title: "Synthetic section" });
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });
describe("videos card", () => {
  it("is a closed dropdown that shows how many links are saved", async () => {
    show(); await screen.findByText(/Found a helpful video/);
    const details = document.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")!.textContent).toContain("optional");
    await add();
    expect(details.querySelector("summary")!.textContent).toContain("1 saved");
  });
  it("shows empty state, adds, focuses URL, confirms removal, and persists", async () => {
    show(); await screen.findByText(/Found a helpful video/);
    const link = await add();
    expect(link.getAttribute("href")).toBe("https://youtube.com/watch?v=synthetic");
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Paste a YouTube or video link"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await repositories.materialVideoLinks.list("section")).toHaveLength(1);
    const dialog = screen.getByRole("dialog", { name: "Remove video link?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
    expect(await repositories.materialVideoLinks.list("section")).toEqual([]);
  });
  it("shows the friendly bad-link error", async () => {
    show(); await screen.findByText(/Found a helpful video/);
    fireEvent.change(screen.getByPlaceholderText("Paste a YouTube or video link"), { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(screen.getByRole("form"));
    expect((await screen.findByRole("alert")).textContent).toBe("That doesn't look like a web link. Copy it from the browser's address bar.");
    expect(await repositories.materialVideoLinks.list("section")).toEqual([]);
  });
  it("renames and opens links in the browser and desktop", async () => {
    const browser = vi.spyOn(window, "open").mockReturnValue(null);
    show(); await screen.findByText(/Found a helpful video/);
    const link = await add(""); fireEvent.click(link);
    expect(browser).toHaveBeenCalledWith("https://youtube.com/watch?v=synthetic", "_blank", "noopener,noreferrer");
    vi.mocked(isTauri).mockReturnValue(true); fireEvent.click(link);
    expect(openUrl).toHaveBeenCalledWith("https://youtube.com/watch?v=synthetic");
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename video link" });
    fireEvent.change(within(dialog).getByLabelText("Name (optional)"), { target: { value: " New name " } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Save name" }).closest("form")!);
    await screen.findByRole("link", { name: "New name" });
    expect((await repositories.materialVideoLinks.list("section"))[0]?.title).toBe("New name");
  });
});
