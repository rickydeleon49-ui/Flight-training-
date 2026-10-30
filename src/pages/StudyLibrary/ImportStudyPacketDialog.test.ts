// @vitest-environment jsdom
/**
 * Slice B import dialog in the real Study Library, on a real node:sqlite
 * database. Only the native file picker is replaced. Row IDs from the
 * accepted preparation §5 (TB-UI-*, TB-REFRESH-01).
 */
import { readFileSync } from "node:fs";
import { createElement as h, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { ConfirmDialog } from "@/components/ui";
import type { NativeImportSaveResult, StructuredImportSaveOperation } from "@/data/db";
import { StructuredImportSaveError } from "@/data/persistenceErrors";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import * as studyPackets from "@/services/studyPackets";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { removeCapabilities } from "@/testing/capabilities";

import { IMPORT_REFRESH_WARNING, IMPORTED_CONTENT_DISCLAIMER, ImportStudyPacketDialog } from "./ImportStudyPacketDialog";
import { MaterialDetail } from "./MaterialDetail";
import { StudyLibrary } from "./StudyLibrary";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

// jsdom tests have no file: import.meta.url, so resolve from the project root.
const PACKET_TEXT = readFileSync(
  `${process.cwd()}/src/testing/fixtures/study-packets/02-flashcards-and-test.json`,
  "utf8",
);
const picked = (text = PACKET_TEXT): studyPackets.PickedStudyPacket => ({
  fileName: "letters.json",
  byteLength: text.length,
  sha256: "d5101e8c58c70c21943295bb22ec5c88394c8db81aeec402bd8f7836612e1f99",
  text,
  bomRemoved: false,
});

let context: ReturnType<typeof useAppData>;
let location: ReturnType<typeof useLocation>;
function Probe() {
  context = useAppData();
  location = useLocation();
  return null;
}

function Ready() {
  const { status } = useAppData();
  return status === "ready"
    ? h(
        Routes,
        null,
        h(Route, { path: "/study", element: h(StudyLibrary) }),
        h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }),
      )
    : null;
}

async function openLibrary() {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/study"] }, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"));
  await screen.findByRole("heading", { name: "Study Library" });
}

const importButton = () => screen.getByRole("button", { name: /Import study packet/ });
const importDialog = () => screen.getByRole("dialog", { name: "Import study packet" });
const confirmButton = () => screen.getByRole("button", { name: "Add to my Study Library" });
/** Materials holding imported content (the app also seeds starter materials). */
const importedCount = async () =>
  (
    await db.select(
      `SELECT id FROM study_materials WHERE id IN (
         SELECT source_material_id FROM ai_study_sets WHERE provider = 'import'
         UNION SELECT source_material_id FROM practice_tests WHERE provider = 'import')`,
    )
  ).length;
const totalMaterials = async () => (await db.select("SELECT id FROM study_materials")).length;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openPreview() {
  fireEvent.click(importButton());
  await screen.findByRole("heading", { name: "Letters and labels" });
}

let saveSpy: MockInstance<(operation: StructuredImportSaveOperation) => Promise<NativeImportSaveResult>>;
let realSave: (operation: StructuredImportSaveOperation) => Promise<NativeImportSaveResult>;

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  db = await createNodeSqliteDatabase();
  realSave = db.saveStructuredImportAtomically!.bind(db);
  saveSpy = vi.spyOn(db as Required<TestDatabase>, "saveStructuredImportAtomically");
  vi.spyOn(studyPackets, "pickStudyPacket").mockResolvedValue(picked());
});

afterEach(() => {
  cleanup();
  db.close();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("with native modal dialogs", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
  });

  it("previews the packet, imports it as a new material and opens it", async () => {
    await openLibrary();
    await openPreview();
    const dialog = importDialog();
    expect(within(dialog).getByText("Will be imported as a new material")).toBeTruthy();
    expect(within(dialog).getByText(/From letters\.json/)).toBeTruthy();
    expect(within(dialog).getByText("3 flashcards")).toBeTruthy();
    expect(within(dialog).getByText("2 practice questions")).toBeTruthy();
    expect(within(dialog).getByText(IMPORTED_CONTENT_DISCLAIMER)).toBeTruthy();
    expect(within(dialog).getByText("Source details from the file (not checked)")).toBeTruthy();
    expect(within(dialog).getByText(/Shown here but not saved: 2 source references/)).toBeTruthy();
    expect(saveSpy).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());
    await waitFor(() => expect(location.pathname).toMatch(/^\/study\/[0-9a-f-]{36}$/));
    const id = location.pathname.split("/").pop()!;
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const operation = saveSpy.mock.calls[0]![0];
    expect(operation.materialId).toBe(id);
    expect(operation.operationId).toBe(id);
    expect(operation.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await screen.findAllByText("Imported study packet")).length).toBeGreaterThan(0);
    expect(await importedCount()).toBe(1);
  });

  it("TB-UI-CAN-01: cancelling the file picker opens nothing and writes nothing", async () => {
    vi.mocked(studyPackets.pickStudyPacket).mockResolvedValue(null);
    await openLibrary();
    const before = await totalMaterials();
    fireEvent.click(importButton());
    await waitFor(() => expect(studyPackets.pickStudyPacket).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(await totalMaterials()).toBe(before);
    // The button works again for the next try.
    expect((importButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("TB-UI-CAN-02: cancelling the preview closes it and writes nothing", async () => {
    await openLibrary();
    const before = await totalMaterials();
    await openPreview();
    fireEvent.click(within(importDialog()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import study packet" })).toBeNull());
    expect(saveSpy).not.toHaveBeenCalled();
    expect(await totalMaterials()).toBe(before);
    expect(await importedCount()).toBe(0);
  });

  it("TB-UI-A11Y-02 (native): Escape and a backdrop click close the preview without writing", async () => {
    await openLibrary();
    await openPreview();
    const dialog = importDialog() as HTMLDialogElement;
    // Escape on a native modal dialog arrives as a cancel event.
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    await openPreview();
    const again = importDialog();
    fireEvent.click(again); // a click on the dialog element itself is the backdrop
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import study packet" })).toBeNull());
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("TB-UI-LOCK-01: a rapid second click sends exactly one save", async () => {
    const pending = deferred<NativeImportSaveResult>();
    saveSpy.mockImplementation(() => pending.promise);
    await openLibrary();
    await openPreview();
    const button = confirmButton();
    // Both clicks land before React re-renders (and disables the button), so
    // only the synchronous ref lock can stop the second one.
    await act(async () => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    // While saving the dialog cannot be dismissed either.
    fireEvent(importDialog(), new Event("cancel", { cancelable: true }));
    expect(importDialog().hasAttribute("open")).toBe(true);
    const id = saveSpy.mock.calls[0]![0].materialId;
    await act(async () => pending.resolve({ status: "saved", materialId: id }));
    await waitFor(() => expect(location.pathname).toBe(`/study/${id}`));
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("a failed save keeps the preview; Try again resends the same identity and succeeds", async () => {
    saveSpy.mockRejectedValueOnce(new StructuredImportSaveError("STORAGE_FAILURE"));
    await openLibrary();
    await openPreview();
    fireEvent.click(confirmButton());
    const alert = await screen.findByText(/could not be saved just now/);
    expect(alert.getAttribute("role")).toBe("alert");
    // Shown in the dialog, not duplicated in the page banner.
    expect(context.lastError).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(location.pathname).toMatch(/^\/study\//));
    const [first, second] = saveSpy.mock.calls.map((call) => call[0]);
    expect(second).toEqual(first);
    expect(await importedCount()).toBe(1);
  });

  it("an unexpected error is never shown raw", async () => {
    saveSpy.mockRejectedValueOnce(new Error("SQLITE_CORRUPT: private detail at /Users/someone"));
    await openLibrary();
    await openPreview();
    fireEvent.click(confirmButton());
    await screen.findByText("The study packet could not be saved. Nothing was changed. Try again.");
    expect(document.body.textContent).not.toContain("private detail");
  });

  it("TB-REFRESH-01: a failed refresh after a successful save keeps the save, records the warning and does not roll back", async () => {
    await openLibrary();
    await openPreview();
    const select = db.select.bind(db);
    let failReads = false;
    saveSpy.mockImplementation(async (operation) => {
      const result = await realSave(operation);
      failReads = true;
      return result;
    });
    vi.spyOn(db, "select").mockImplementation((sql, params) =>
      failReads ? Promise.reject(new Error("synthetic refresh failure")) : select(sql, params),
    );
    fireEvent.click(confirmButton());
    await waitFor(() => expect(context.lastError).toBe(IMPORT_REFRESH_WARNING));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import study packet" })).toBeNull());
    // It stays on the library rather than open a material the screen cannot show yet.
    expect(location.pathname).toBe("/study");
    failReads = false;
    expect(await importedCount()).toBe(1);
    expect((await db.select("SELECT provider FROM ai_study_sets"))[0]).toEqual({ provider: "import" });
  });

  it("shows validation problems with fixed messages and saves nothing", async () => {
    vi.mocked(studyPackets.pickStudyPacket).mockResolvedValue(
      picked('{"format":"hfd-study-packet","formatVersion":1,"title":"x","apiKey_secret":"sensitive"}'),
    );
    await openLibrary();
    fireEvent.click(importButton());
    const dialog = await screen.findByRole("dialog", { name: "This study packet can't be imported" });
    expect(within(dialog).getByText(/letters\.json/)).toBeTruthy();
    expect(within(dialog).getByRole("alert").textContent).toContain("$");
    expect(dialog.textContent).not.toMatch(/apiKey_secret|sensitive/);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("shows an unreadable file's fixed message", async () => {
    vi.mocked(studyPackets.pickStudyPacket).mockRejectedValue(new studyPackets.StudyPacketReadError("file_too_large"));
    await openLibrary();
    fireEvent.click(importButton());
    expect(await screen.findByText("The file is larger than the 4 MiB limit for a study packet.")).toBeTruthy();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("without native modal dialogs (macOS 12.0–12.2 fallback, source-level only)", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = removeCapabilities([
      [HTMLDialogElement.prototype, "showModal"],
      [HTMLDialogElement.prototype, "close"],
    ]);
  });
  afterEach(() => restore());

  const tab = (shift = false) =>
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey: shift });
  const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

  it("TB-UI-A11Y-01: focus starts inside, Tab stays inside, and the page behind is out of reach", async () => {
    await openLibrary();
    await openPreview();
    const dialog = importDialog();
    expect(dialog.contains(document.activeElement)).toBe(true);
    const buttons = within(dialog).getAllByRole("button");
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    last.focus();
    tab();
    expect(document.activeElement).toBe(first);
    first.focus();
    tab(true);
    expect(document.activeElement).toBe(last);
    const behind = screen.getByRole("heading", { name: "Study Library", hidden: true });
    expect(behind.closest("[aria-hidden='true']")).not.toBeNull();
    expect(behind.closest("[inert]")).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("TB-UI-A11Y-02 (fallback): Escape and the backdrop close the preview; focus returns; nothing is written", async () => {
    await openLibrary();
    importButton().focus();
    await openPreview();
    escape();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import study packet" })).toBeNull());
    await openPreview();
    fireEvent.click(document.querySelector(".modal-fallback-backdrop")!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import study packet" })).toBeNull());
    expect(document.querySelector("[inert]")).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("TB-UI-A11Y-03: Escape closes a nested dialog first and leaves the import preview open", async () => {
    const onImportClose = vi.fn();
    const onNestedCancel = vi.fn();
    function Harness() {
      const [nested, setNested] = useState(false);
      return h(
        "div",
        null,
        h("main", null, h("button", { type: "button", onClick: () => setNested(true) }, "Open nested")),
        h(ImportStudyPacketDialog, { open: true, onClose: onImportClose, onImported: () => {} }),
        h(ConfirmDialog, {
          open: nested,
          title: "Nested question",
          message: "Synthetic nested confirmation",
          destructive: false,
          confirmLabel: "OK",
          onConfirm: () => setNested(false),
          onCancel: () => {
            onNestedCancel();
            setNested(false);
          },
        }),
      );
    }
    render(h(AppDataProvider, null, h(MemoryRouter, null, h(Probe), h(Harness))));
    await waitFor(() => expect(context.status).toBe("ready"));
    await screen.findByRole("heading", { name: "Letters and labels" });
    fireEvent.click(screen.getByRole("button", { name: "Open nested", hidden: true }));
    await screen.findByRole("dialog", { name: "Nested question" });
    escape();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nested question" })).toBeNull());
    expect(onNestedCancel).toHaveBeenCalledTimes(1);
    expect(onImportClose).not.toHaveBeenCalled();
    expect(importDialog().hasAttribute("open")).toBe(true);
    // The import preview is on top again and handles the next Escape.
    escape();
    expect(onImportClose).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("SB-R1 confirmation preview regressions", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
  });

  const GUIDE_ONLY_TEXT = readFileSync(
    `${process.cwd()}/src/testing/fixtures/study-packets/01-guide-only.json`,
    "utf8",
  );
  const QUESTIONS_ONLY_TEXT = readFileSync(
    `${process.cwd()}/src/testing/fixtures/study-packets/04-questions-only.json`,
    "utf8",
  );

  it("SB-R1: lets the owner inspect packet content before any save", async () => {
    await openLibrary();
    await openPreview();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(await importedCount()).toBe(0);
    const text = importDialog().textContent;
    expect(text).toContain("Cards and an explicit structured test.");
    expect(text).toContain("Which letter follows B?");
    expect(text).toContain("In the invented alphabet, which label comes after Plinth 1?");
    expect(text).toContain("Zorb");
    expect(text).toContain("Quill");
    expect(text).toContain("In this made-up sequence, Quill always follows Plinth.");
  });

  it("SB-R1: shows each item's unverified reference before discarding it", async () => {
    await openLibrary();
    await openPreview();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(await importedCount()).toBe(0);
    const text = importDialog().textContent;
    expect(text).toContain("Invented chart");
    expect(text).toContain("Invented chart section 2");
    expect(text).toMatch(/unverified/i);
  });

  it("SB-R1: displays all counts and truthful discard disclosure including choice IDs", async () => {
    await openLibrary();
    await openPreview();
    const dialog = importDialog();
    expect(within(dialog).getByText(/3 flashcards/)).toBeTruthy();
    expect(within(dialog).getByText(/2 practice questions/)).toBeTruthy();
    expect(within(dialog).getByText(/6 choices/)).toBeTruthy();
    expect(within(dialog).getAllByText(/2 source references/).length).toBeGreaterThanOrEqual(2);
    expect(dialog.textContent).toContain("6 choice IDs");
    expect(dialog.textContent).toContain("the packet's item IDs");
    expect(dialog.textContent).toContain("2 source references");
    expect(dialog.textContent).toContain("the file's source details");
  });

  it("SB-R1: confirms that nothing is uploaded and answers come from the packet rather than Her Flight Deck or an AI provider", async () => {
    await openLibrary();
    await openPreview();
    const dialog = importDialog();
    expect(dialog.textContent).toContain("Nothing is uploaded");
    expect(dialog.textContent).toContain("Questions, answers, and explanations come from the packet, rather than Her Flight Deck or an AI provider");
  });

  it("SB-R1: truthfully handles guide-only packets with explicit absence wording", async () => {
    vi.mocked(studyPackets.pickStudyPacket).mockResolvedValue(picked(GUIDE_ONLY_TEXT));
    await openLibrary();
    fireEvent.click(importButton());
    await screen.findByRole("heading", { name: "Letter order guide" });
    const dialog = importDialog();
    expect(dialog.textContent).toContain("No practice test: this packet has no structured questions.");
    expect(dialog.textContent).toContain("Labels");
    expect(dialog.textContent).toContain("Plinth");
    expect(saveSpy).not.toHaveBeenCalled();
    expect(await importedCount()).toBe(0);
  });

  it("SB-R1: truthfully handles questions-only packets with explicit absence wording", async () => {
    vi.mocked(studyPackets.pickStudyPacket).mockResolvedValue(picked(QUESTIONS_ONLY_TEXT));
    await openLibrary();
    fireEvent.click(importButton());
    await screen.findByRole("heading", { name: "Questions only" });
    const dialog = importDialog();
    expect(dialog.textContent).toContain("No study guide: this packet has no study guide or flashcards.");
    expect(dialog.textContent).toContain("In the invented alphabet, which label comes after Plinth 1?");
    expect(saveSpy).not.toHaveBeenCalled();
    expect(await importedCount()).toBe(0);
  });

  it("SB-R1: preview navigation and cancellation cause zero save calls and zero imported rows", async () => {
    await openLibrary();
    await openPreview();
    const dialog = importDialog();
    // Verify preview content is present and can be navigated
    expect(within(dialog).getByText("Which letter follows B?")).toBeTruthy();
    // Cancel preview
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import study packet" })).toBeNull());
    expect(saveSpy).not.toHaveBeenCalled();
    expect(await importedCount()).toBe(0);
  });

  it("SB-R1: subsequent save discards preview-only fields and preserves operation identity across retries", async () => {
    await openLibrary();
    await openPreview();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(location.pathname).toMatch(/^\/study\/[0-9a-f-]{36}$/));
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const operation = saveSpy.mock.calls[0]![0];
    expect(operation.operationId).toBe(operation.materialId);

    // Verify preview-only fields were discarded in payload
    expect(operation.studySet?.flashcards.every((c) => c.sourcePage === null)).toBe(true);
    expect(operation.practiceTest?.questions.every((q) => q.sourcePage === null)).toBe(true);
    expect((operation.studySet as Record<string, unknown>).sourceRefs).toBeUndefined();
    expect((operation.studySet?.flashcards[1] as Record<string, unknown>).sourceRefs).toBeUndefined();
    expect((operation.practiceTest?.questions[0] as Record<string, unknown>).sourceRefs).toBeUndefined();
  });
});


it("import_preview_counts_before_add", async () => {
  const packet = JSON.parse(PACKET_TEXT);
  packet.guide = { summary: "Synthetic summary", sections: [{ heading: "One", body: "Synthetic body" }] };
  vi.mocked(studyPackets.pickStudyPacket).mockResolvedValue(picked(JSON.stringify(packet)));
  await openLibrary(); await openPreview();
  const dialog = importDialog();
  expect(within(dialog).getByText("Study guide, 1 section")).toBeTruthy();
  expect(within(dialog).getByText("3 flashcards")).toBeTruthy();
  expect(within(dialog).getByText("2 practice questions")).toBeTruthy();
  expect(within(dialog).getByText("Imported from a study packet. Please check it against your PDF and current guidance.")).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Add to my Study Library" })).toBeTruthy();
  expect(saveSpy).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(await importedCount()).toBe(0);
});


it("a cards-only preview does not count a guide", async () => {
  const packet = JSON.parse(PACKET_TEXT); delete packet.guide; delete packet.questions;
  vi.mocked(studyPackets.pickStudyPacket).mockResolvedValue(picked(JSON.stringify(packet)));
  await openLibrary(); await openPreview();
  expect(within(importDialog()).getByText("No study guide: this packet contains cards without a guide.")).toBeTruthy();
  expect(within(importDialog()).getByText("3 flashcards")).toBeTruthy();
  expect(saveSpy).not.toHaveBeenCalled();
});

it.each(["oversize", "credential"])("refuses %s content before Add", async kind => {
  const text = kind === "oversize" ? " ".repeat(4 * 1024 * 1024 + 1) : PACKET_TEXT.replace("Letters and labels", `AIza${"A".repeat(35)}`);
  vi.mocked(studyPackets.pickStudyPacket).mockResolvedValue(picked(text));
  await openLibrary(); fireEvent.click(importButton());
  await screen.findByRole("dialog", { name: "This study packet can't be imported" });
  expect(screen.queryByRole("button", { name: "Add to my Study Library" })).toBeNull();
  expect(saveSpy).not.toHaveBeenCalled(); expect(await importedCount()).toBe(0);
});
