// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "@/data/repositories";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import * as documents from "@/services/documents";
import * as gemini from "@/services/gemini";
import * as pdf from "@/services/pdf";
import { MaterialDetail } from "./MaterialDetail";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
let context: ReturnType<typeof useAppData>;
function Ready() {
  context = useAppData();
  return context.status === "ready" ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) })) : null;
}
beforeEach(async () => {
  localStorage.clear(); db = await createNodeSqliteDatabase();
  await createRepositories(db).documents.create({ id: "tips", title: "Synthetic PDF", filePath: "documents/synthetic.pdf", originalFileName: "synthetic.pdf", fileSize: 2048 });
  vi.spyOn(documents, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documents, "documentExists").mockResolvedValue(true);
  vi.spyOn(pdf, "canSplitPdfs").mockReturnValue(true);
  vi.spyOn(gemini, "getGeminiStatus").mockResolvedValue({ configured: false, model: "gemini-3.5-flash", choice: "standard" });
  vi.spyOn(gemini, "watchGeminiProgress").mockResolvedValue(() => {});
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

it("places Start here first, connects its destinations, and explains file, page and review actions", async () => {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/study/tips"] }, h(Ready))));
  await screen.findByRole("heading", { name: "Start here" });
  await waitFor(() => expect(context.repositories).toBeTruthy());
  // The page chooser uses the same navigation repository in desktop mode;
  // only its capability is enabled here. No file is opened or inspected.
  vi.spyOn(context.repositories!.navigation, "canCheckFiles").mockReturnValue(true);
  // Trigger a normal app reload to render the desktop page controls.
  await context.mutate(repos => repos.documents.update("tips", { notes: "Synthetic note" }));
  expect(screen.getByRole("heading", { name: "Start here" }).closest(".detail__column")?.firstElementChild?.textContent).toContain("Start here");
  for (const id of ["material-file-actions", "material-offline-study", "material-pdf-kit", "material-study-guide"]) {
    expect(document.getElementById(id)).toBeTruthy();
  }
  expect(screen.getByText("Makes parts of up to 50 MB; each becomes its own library item. Your original stays as it is.")).toBeTruthy();
  expect(screen.getByText("Choose a page range, like 12–40, to make a smaller copy.")).toBeTruthy();
  expect(screen.getByText("Opens the PDF in your Mac's PDF app.")).toBeTruthy();
  expect(await screen.findByText("Check pages counts this PDF's pages and checks whether the file has changed.")).toBeTruthy();
  expect(screen.getByText("Open at page opens your PDF reader and remembers the page you asked for. You may need to go to that page in the reader.")).toBeTruthy();
  expect(screen.getByText("Save a named place so you can return to it later without remembering the page number.")).toBeTruthy();
  expect(screen.getByText("Needs Review and Studying make this material eligible for suggestions in Today's Flight Plan.")).toBeTruthy();
  expect(screen.getByText("Records today's date as your last review. Choose your review status separately.")).toBeTruthy();
});
