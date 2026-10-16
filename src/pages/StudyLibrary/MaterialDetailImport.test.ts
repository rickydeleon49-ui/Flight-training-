// @vitest-environment jsdom
/**
 * Imported content in MaterialDetail (Slice B): labelled as imported, never
 * as Gemini output, and warned about before Gemini replaces it.
 * Row IDs from the accepted preparation §5 (TB-UI-WARN-01, TB-UI-REGEN-01).
 */
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StructuredImportSaveOperation } from "@/data/db";
import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import * as documentService from "@/services/documents";
import * as geminiService from "@/services/gemini";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

import { IMPORTED_CONTENT_DISCLAIMER } from "./ImportStudyPacketDialog";
import {
  IMPORT_GUIDE_REGENERATE_WARNING,
  IMPORT_TEST_REGENERATE_WARNING,
  MaterialDetail,
} from "./MaterialDetail";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

const OPERATION: StructuredImportSaveOperation = JSON.parse(
  readFileSync(`${process.cwd()}/src-tauri/fixtures/import-contract/operation.json`, "utf8"),
);
const ID = OPERATION.materialId;

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}

async function open(id: string) {
  render(
    h(
      AppDataProvider,
      null,
      h(
        MemoryRouter,
        { initialEntries: [`/study/${id}`] },
        h(Probe),
        h(() =>
          useAppData().status === "ready"
            ? h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }))
            : null,
        ),
      ),
    ),
  );
  await waitFor(() => expect(context.status).toBe("ready"));
}

/** Attach a (synthetic) file, the precondition for offering Gemini at all. */
async function attachFile(id: string) {
  await createRepositories(db).documents.update(id, {
    filePath: `${id}/handout.pdf`,
    originalFileName: "handout.pdf",
    fileSize: 2048,
  });
}

beforeEach(async () => {
  localStorage.clear();
  db = await createNodeSqliteDatabase();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.spyOn(geminiService, "getGeminiStatus").mockResolvedValue({ configured: true, model: "gemini-3.5-flash" });
  vi.spyOn(geminiService, "watchGeminiProgress").mockResolvedValue(() => {});
  vi.spyOn(documentService, "canHandleFiles").mockReturnValue(true);
  vi.spyOn(documentService, "documentExists").mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  db.close();
  vi.restoreAllMocks();
});

describe("imported content in MaterialDetail", () => {
  it("TB-UI-WARN-01: labels imported content as imported, shows the disclaimer and hides Gemini wording", async () => {
    await createRepositories(db).documents.importStudyPacket(OPERATION);
    await open(ID);
    expect(await screen.findByText("Imported study packet", { selector: "h2, h3" })).toBeTruthy();
    expect(screen.getAllByText(IMPORTED_CONTENT_DISCLAIMER)).toHaveLength(2);
    expect(screen.queryByText("Gemini study assistant")).toBeNull();
    expect(screen.queryByText(/AI-generated study aid/)).toBeNull();
    expect(screen.queryByText(/AI-generated practice test/)).toBeNull();
    expect(screen.queryByText(/Gemini will read only this file/)).toBeNull();
    // The imported content itself is there, offline.
    expect(screen.getByText("Cards and an explicit structured test.")).toBeTruthy();
    expect(screen.getByText("Which letter follows A?")).toBeTruthy();
  });

  it("TB-UI-WARN-01: with a file attached, the Gemini empty-state invitation stays hidden", async () => {
    const testOnly = { ...structuredClone(OPERATION), studySet: null };
    await createRepositories(db).documents.importStudyPacket(testOnly);
    await attachFile(ID);
    await open(ID);
    await screen.findByText(IMPORTED_CONTENT_DISCLAIMER);
    expect(screen.queryByText(/Gemini will read only this file/)).toBeNull();
  });

  it("TB-UI-REGEN-01: regenerating an imported guide or test warns that Gemini will replace it", async () => {
    await createRepositories(db).documents.importStudyPacket(OPERATION);
    await attachFile(ID);
    await open(ID);
    const [guideRegenerate, testRegenerate] = await screen.findAllByRole("button", { name: "Regenerate" });

    fireEvent.click(guideRegenerate!);
    let confirm = await screen.findByRole("dialog", { name: "Send this file to Google?" });
    expect(within(confirm).getByText(new RegExp(`^${IMPORT_GUIDE_REGENERATE_WARNING}`))).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Send this file to Google?" })).toBeNull());

    fireEvent.click(testRegenerate!);
    confirm = await screen.findByRole("dialog", { name: "Send this file to Google?" });
    expect(within(confirm).getByText(new RegExp(`^${IMPORT_TEST_REGENERATE_WARNING}`))).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    // Cancelling replaced nothing.
    const sets = await createRepositories(db).documents.listAiStudySets();
    expect(sets.map((set) => set.provider)).toEqual(["import"]);
  });

  it("Gemini content keeps its own labels and no import warning", async () => {
    const repos = createRepositories(db);
    await repos.documents.create({ id: "gemini-material", title: "Synthetic handbook" });
    await attachFile("gemini-material");
    await repos.documents.saveAiStudySet({
      sourceMaterialId: "gemini-material",
      title: "Synthetic guide",
      summary: "Synthetic summary",
      sections: [],
      flashcards: [],
      sourceNotes: "",
      model: "gemini-3.5-flash",
    });
    await open("gemini-material");
    expect(await screen.findByText("Gemini study assistant")).toBeTruthy();
    expect(screen.getByText(/AI-generated study aid/)).toBeTruthy();
    expect(screen.queryByText(IMPORTED_CONTENT_DISCLAIMER)).toBeNull();
    // The button appears only once the Gemini status read resolves, which can
    // land after the heading renders, so wait for it rather than racing it.
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    const confirm = await screen.findByRole("dialog", { name: "Send this file to Google?" });
    expect(confirm.textContent).not.toContain("imported");
  });
});
