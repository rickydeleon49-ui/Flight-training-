// @vitest-environment jsdom
/** LIBRARY-ORG-01 slice 10: Move to folder on the material page. Synthetic records, real SQLite. */
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createRepositories, type Repositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import * as documentService from "@/services/documents";
import * as geminiService from "@/services/gemini";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { useStatusAfterEffects, waitForReadyAfterEffects } from "@/testing/afterEffects";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

function Probe() {
  useStatusAfterEffects(useAppData().status);
  return null;
}
function Ready() {
  return useAppData().status === "ready"
    ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }))
    : null;
}

let repos: Repositories;
beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
  await repos.app.set("airline_starter_pack", "skipped-for-test");
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: false, model: "gemini-3.5-flash", choice: "standard" });
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
  await repos.documents.create({ id: "mat-a", title: "METAR handout", filePath: "documents/a.pdf", originalFileName: "a.pdf", fileSize: 10 });
  await repos.libraryFolders.createFolder("Weather");
});
afterEach(() => { cleanup(); db.close(); vi.restoreAllMocks(); });

it("moving from the File menu shows In: Weather under the title", async () => {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/study/mat-a"] }, h(Probe), h(Ready))));
  await waitForReadyAfterEffects();
  await screen.findByRole("heading", { name: "METAR handout" });
  expect(screen.queryByText("In: Weather")).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Move to folder…" }));
  fireEvent.click(await screen.findByRole("button", { name: "Weather" }));
  expect(await screen.findByText("In: Weather")).toBeTruthy();
});
