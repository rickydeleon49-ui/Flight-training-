// @vitest-environment jsdom
/**
 * M4 Slice 1 interface: the material pages panel and the source badges in the
 * real MaterialDetail, inside AppDataProvider over a disposable node:sqlite
 * database with the real navigation transaction. The desktop inspector and
 * verified opener are stand-ins on that database (they record what they were
 * asked); no real file, reader, profile, provider or network is used.
 *
 * "Open at page" and its reading marks were removed from the panel (owner,
 * 22 October; macOS cannot reliably open a reader at a page), so these tests
 * assert those controls are gone while Check pages and bookmarks — including
 * a bookmark's own open, which still hands the file to the reader with its
 * page shown next to it — keep working.
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InspectedNavigationIdentity } from "@/domain/types";
import { NAVIGATION_ERROR_MESSAGES, NavigationError } from "@/data/navigationTransaction";
import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider } from "@/state/AppDataContext";
import { useNavigationController } from "@/state/navigation/useDocumentNavigation";

import { SAVED_PLACE_MESSAGES } from "@/state/navigation/controller";
import type { StudyMaterial } from "@/domain/types";

import { MaterialDetail } from "../MaterialDetail";
import { DocumentPagesPanel, DRAFT_STALE_MESSAGE } from "./DocumentPagesPanel";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

const M = "nav-material";
const A = "a".repeat(64);
const B = "b".repeat(64);

let fileHash: string;
let inspectFails: unknown;
let commitFails: unknown;
let opened: { materialId: string; hash: string }[];
let inspectHeld: Promise<void> | null;
let operationHeld: { kind: string; promise: Promise<void> } | null;

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

async function seed({ desktop = true, cards = [{ front: "Class C ceiling?", back: "4,000 ft AGL.", sourcePage: 12 }] } = {}) {
  db = await createNodeSqliteDatabase();
  await createRepositories(db).documents.create({ id: M, title: "Synthetic handbook", filePath: "ifh.pdf", originalFileName: "ifh.pdf", fileSize: 1000 });
  await db.execute(
    `INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes, provider, model, generated_at, updated_at)
     VALUES (?, 'Synthetic guide', 'A synthetic summary.', '[]', ?, '', 'import', '', 'x', 'x')`,
    [M, JSON.stringify(cards)],
  );
  if (!desktop) return;
  db.inspectNavigationIdentity = async (materialId): Promise<InspectedNavigationIdentity> => {
    if (inspectHeld) await inspectHeld;
    if (inspectFails) throw inspectFails;
    const hash = fileHash;
    await db.execute(
      `INSERT INTO material_content_identities VALUES (?, ?, 50, 'x')
       ON CONFLICT(material_id) DO UPDATE SET content_sha256 = excluded.content_sha256`,
      [materialId, hash],
    );
    // As the native inspector does: saved places on other content drift.
    await db.execute("UPDATE material_bookmarks SET status = 'drifted' WHERE material_id = ? AND originating_content_sha256 <> ?", [materialId, hash]);
    await db.execute("UPDATE material_reading_state SET status = 'drifted' WHERE material_id = ? AND originating_content_sha256 <> ?", [materialId, hash]);
    return { materialId, contentSha256: hash, totalPages: 50, verifiedAt: "x", changed: false };
  };
  db.openNavigationDocument = async (materialId, hash) => {
    if (hash !== fileHash) throw new NavigationError("FILE_CHANGED", NAVIGATION_ERROR_MESSAGES.FILE_CHANGED);
    opened.push({ materialId, hash });
  };
  const operation = db.navigationOperation!.bind(db);
  db.navigationOperation = (async (op: Parameters<typeof operation>[0]) => {
    if (operationHeld && op.kind === operationHeld.kind) {
      const held = operationHeld.promise;
      operationHeld = null;
      await held;
    }
    if (op.kind === "commit" && commitFails) {
      const error = commitFails;
      commitFails = undefined;
      throw error;
    }
    return operation(op);
  }) as typeof db.navigationOperation;
}

/** The shared controller, as any other view inside the provider sees it. */
let sharedController: ReturnType<typeof useNavigationController>["controller"] = null;
function ControllerProbe() {
  sharedController = useNavigationController().controller;
  return null;
}

function renderDetail() {
  return render(
    h(
      AppDataProvider,
      null,
      h(ControllerProbe),
      h(MemoryRouter, { initialEntries: [`/study/${M}`] }, h(Routes, null, h(Route, { path: "/study/:materialId", element: h(MaterialDetail) }))),
    ),
  );
}

const panel = async () => {
  const heading = await screen.findByRole("heading", { name: "Find your place" });
  return heading.closest(".card") as HTMLElement;
};

async function tuple() {
  const [row] = await db.select<{ t: string }>(
    "SELECT json_array(last_requested_page, confirmed_read, originating_content_sha256, status, owner_generation) AS t FROM material_reading_state WHERE material_id = ?",
    [M],
  );
  return row ? JSON.parse(row.t) : null;
}

/** Checks the pages, adds one bookmark and returns the rendered list. */
async function addBookmark(scope: HTMLElement, page: string, title: string, label?: string) {
  fireEvent.click(within(scope).getByRole("button", { name: "Check pages" }));
  await within(scope).findByText("This PDF has 50 pages.");
  fireEvent.click(within(scope).getByRole("button", { name: "Add bookmark" }));
  const dialog = await screen.findByRole("dialog", { name: "Add a bookmark" });
  fireEvent.change(within(dialog).getByLabelText("PDF page"), { target: { value: page } });
  if (label !== undefined) fireEvent.change(within(dialog).getByLabelText("Printed page (optional)"), { target: { value: label } });
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: title } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save bookmark" }));
  return within(scope).findByRole("list", { name: "Bookmarks" });
}

beforeEach(() => {
  fileHash = A;
  inspectFails = undefined;
  commitFails = undefined;
  opened = [];
  inspectHeld = null;
  operationHeld = null;
});

afterEach(() => {
  cleanup();
  db?.close();
});

describe("the pages panel", () => {
  it("no longer offers open-at-page or its reading marks, and keeps Check pages and Bookmarks", async () => {
    // Reverting the removal makes these absence assertions fail.
    await seed();
    renderDetail();
    const scope = await panel();
    expect(within(scope).queryByLabelText("PDF page")).toBeNull();
    expect(within(scope).queryByRole("button", { name: "Open at page" })).toBeNull();
    expect(within(scope).queryByText(/Open at page opens your PDF reader/)).toBeNull();
    expect(within(scope).queryByText(/Last page you asked to open/)).toBeNull();
    expect(within(scope).queryByRole("checkbox", { name: /I've read this page/ })).toBeNull();

    // Kept: the page count line and Check pages with its tip.
    await within(scope).findByText("This file's pages haven't been checked yet. Use Check pages to count them.");
    fireEvent.click(within(scope).getByRole("button", { name: "Check pages" }));
    await within(scope).findByText("This PDF has 50 pages.");
    expect(within(scope).getByText("Check pages counts this PDF's pages and checks whether the file has changed.")).toBeTruthy();

    // Kept: bookmarks. addBookmark drives the dialog's own "PDF page" field
    // (the only page input left, and the only one under this card while the
    // dialog is open); opening a bookmark still hands the file to the reader
    // with the bookmark's page shown next to it — without the removed status.
    const list = await addBookmark(scope, "9", "Charts");
    expect(within(scope).queryByLabelText("PDF page")).toBeNull();
    expect(within(list).getByText("Charts")).toBeTruthy();
    expect(within(list).getByText("PDF page 9")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: "Open Charts at PDF page 9" }));
    await waitFor(() => expect(opened).toEqual([{ materialId: M, hash: A }]));
    expect(within(scope).queryByText(/Opened in your PDF reader/)).toBeNull();
  });

  it("a bookmark that opened but could not be saved offers a save-only retry that does not reopen the file", async () => {
    await seed();
    renderDetail();
    const scope = await panel();
    const list = await addBookmark(scope, "7", "Retry place");
    commitFails = new NavigationError("STORAGE_FAILURE", NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE);
    fireEvent.click(within(list).getByRole("button", { name: "Open Retry place at PDF page 7" }));
    const retry = await within(scope).findByRole("button", { name: "Try saving again" });
    expect(within(scope).getByText(/Opened, but the page wasn't saved/)).toBeTruthy();
    expect(await tuple()).toBeNull();
    fireEvent.click(retry);
    await waitFor(async () => expect(await tuple()).toEqual([7, 0, A, "active", 1]));
    expect(opened).toHaveLength(1);
  });

  it("a missing file explains itself and keeps restore reachable", async () => {
    // The controller's failure path (here: a source badge's check) is what
    // shows the panel's restore affordance; a failed "Check pages" only
    // reports the error line.
    await seed();
    renderDetail();
    const scope = await panel();
    inspectFails = new NavigationError("FILE_MISSING", NAVIGATION_ERROR_MESSAGES.FILE_MISSING);
    const badge = await screen.findByRole("button", { name: /Source p\. 12/ });
    fireEvent.click(badge);
    expect(await within(scope).findByText(NAVIGATION_ERROR_MESSAGES.FILE_MISSING)).toBeTruthy();
    expect(within(scope).getByRole("button", { name: "Find and restore file" })).toBeTruthy();
  });

  it("adds, lists, opens and removes a bookmark bound to the checked content", async () => {
    await seed();
    renderDetail();
    const scope = await panel();
    fireEvent.click(within(scope).getByRole("button", { name: "Check pages" }));
    await within(scope).findByText("This PDF has 50 pages.");
    fireEvent.click(within(scope).getByRole("button", { name: "Add bookmark" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a bookmark" });
    fireEvent.change(within(dialog).getByLabelText("PDF page"), { target: { value: "60" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  Airspace chart  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save bookmark" }));
    expect(await within(dialog).findByText("This PDF has 50 pages, so there is no page 60.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("PDF page"), { target: { value: "9" } });
    fireEvent.change(within(dialog).getByLabelText("Printed page (optional)"), { target: { value: "3-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save bookmark" }));
    const list = await within(scope).findByRole("list", { name: "Bookmarks" });
    expect(within(list).getByText("Airspace chart")).toBeTruthy();
    expect(within(list).getByText(/PDF page 9 \(printed page 3-12\)/)).toBeTruthy();
    const [bookmark] = await db.select<{ originating_content_sha256: string; title: string }>("SELECT * FROM material_bookmarks");
    expect(bookmark).toMatchObject({ originating_content_sha256: A, title: "Airspace chart" });

    // Opening a bookmark still hands the file to the reader; its page is
    // shown next to the bookmark, and the removed status stays unseen.
    fireEvent.click(within(list).getByRole("button", { name: /Open Airspace chart at PDF page 9/ }));
    await waitFor(() => expect(opened).toEqual([{ materialId: M, hash: A }]));
    expect(within(scope).queryByText(/Opened in your PDF reader/)).toBeNull();

    fireEvent.click(within(list).getByRole("button", { name: "Remove bookmark Airspace chart" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove this bookmark?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    expect(await within(scope).findByText("No bookmarks yet.")).toBeTruthy();
  });

  it("a bookmark held across a file replacement is refused and nothing is saved", async () => {
    await seed();
    renderDetail();
    const scope = await panel();
    fireEvent.click(within(scope).getByRole("button", { name: "Check pages" }));
    await within(scope).findByText("This PDF has 50 pages.");
    fireEvent.click(within(scope).getByRole("button", { name: "Add bookmark" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a bookmark" });
    // The file is replaced (and rechecked) while the dialog is open.
    fileHash = B;
    await db.inspectNavigationIdentity!(M);
    fireEvent.change(within(dialog).getByLabelText("PDF page"), { target: { value: "4" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Charts" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save bookmark" }));
    expect(await within(dialog).findByText(NAVIGATION_ERROR_MESSAGES.STALE_STATE)).toBeTruthy();
    expect(await db.select("SELECT * FROM material_bookmarks")).toEqual([]);
  });
});

describe("source badges", () => {
  it("open the document with guidance for a cited page and save no position", async () => {
    await seed();
    renderDetail();
    const badge = await screen.findByRole("button", { name: /Source p\. 12: open the source document and look for page 12/ });
    fireEvent.click(badge);
    // The badge's own note (the panel's status line says the same).
    expect(await within(badge.parentElement!).findByText(/The study aid points to page 12, which may be the page number printed in the book/)).toBeTruthy();
    expect(opened).toEqual([{ materialId: M, hash: A }]);
    expect(await tuple()).toBeNull();
    expect(await db.select("SELECT * FROM material_operation_claims")).toEqual([]);
  });

  it("stay plain labels outside the desktop app, where no file can be checked", async () => {
    await seed({ desktop: false });
    renderDetail();
    expect(await screen.findByText("Source p. 12")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Source p\. 12/ })).toBeNull();
    const scope = await panel();
    expect(within(scope).getByText(/Checking pages and opening bookmarks need the desktop app/)).toBeTruthy();
    expect(within(scope).queryByRole("button", { name: "Open at page" })).toBeNull();
  });

  it("without a cited page the badge still says to check the source", async () => {
    await seed({ cards: [{ front: "Q", back: "A", sourcePage: null }] as never });
    renderDetail();
    expect(await screen.findByText("Check source")).toBeTruthy();
  });
});

describe("saved places open only on their own content (M4S1-R5)", () => {
  async function savedBookmark(scope: HTMLElement) {
    fireEvent.click(within(scope).getByRole("button", { name: "Check pages" }));
    await within(scope).findByText("This PDF has 50 pages.");
    fireEvent.click(within(scope).getByRole("button", { name: "Add bookmark" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a bookmark" });
    fireEvent.change(within(dialog).getByLabelText("PDF page"), { target: { value: "9" } });
    fireEvent.change(within(dialog).getByLabelText("Printed page (optional)"), { target: { value: "A-label" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Saved A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save bookmark" }));
    const list = await within(scope).findByRole("list", { name: "Bookmarks" });
    return within(list).getByRole("button", { name: /Open Saved A at PDF page 9/ });
  }

  it("opening a saved A bookmark must not silently target replacement B", async () => {
    // Promoted from the frozen review diagnostic.
    await seed();
    renderDetail();
    const scope = await panel();
    const open = await savedBookmark(scope);
    // Open it once on A: that is what saves the reading state now.
    fireEvent.click(open);
    await waitFor(async () => expect(await tuple()).toEqual([9, 0, A, "active", 1]));
    const before = await tuple();
    opened = [];
    fileHash = B;
    fireEvent.click(open);
    expect(await within(scope).findByText(SAVED_PLACE_MESSAGES.changed)).toBeTruthy();
    expect(opened, "an A bookmark must not open B").toEqual([]);
    expect(await tuple(), "its old coordinate is not saved against B").toEqual(before?.slice(0, 3).concat(["drifted", 1]));
    // The refreshed list says the place may have moved, and offers no open.
    const list = within(scope).getByRole("list", { name: "Bookmarks" });
    await waitFor(() => expect(within(list).queryByRole("button", { name: /Open Saved A/ })).toBeNull());
    expect(within(list).getByText(/PDF page 9 \(printed page A-label\)/)).toBeTruthy();
  });

  it("an unchanged file opens the bookmark's own page and label", async () => {
    await seed();
    renderDetail();
    const scope = await panel();
    const open = await savedBookmark(scope);
    fireEvent.click(open);
    await waitFor(() => expect(opened).toEqual([{ materialId: M, hash: A }]));
    await waitFor(async () => expect(await tuple()).toEqual([9, 0, A, "active", 1]));
    // Where to go stays written next to the bookmark itself; the removed
    // "Opened in your PDF reader…" status is not shown.
    expect(within(scope).getByText(/PDF page 9 \(printed page A-label\)/)).toBeTruthy();
    expect(within(scope).queryByText(/Opened in your PDF reader/)).toBeNull();
  });

  it("a file replaced while the bookmark's inspection is held is refused", async () => {
    await seed();
    renderDetail();
    const scope = await panel();
    const open = await savedBookmark(scope);
    const held = gate();
    inspectHeld = held.promise;
    fireEvent.click(open);
    await within(scope).findByText("Checking the file…");
    fileHash = B;
    inspectHeld = null;
    held.resolve();
    expect(await within(scope).findByText(SAVED_PLACE_MESSAGES.changed)).toBeTruthy();
    expect(opened).toEqual([]);
    expect(await tuple()).toBeNull();
  });

  it("a deleted file explains itself and nothing is opened or saved", async () => {
    await seed();
    renderDetail();
    const scope = await panel();
    const open = await savedBookmark(scope);
    inspectFails = new NavigationError("FILE_MISSING", NAVIGATION_ERROR_MESSAGES.FILE_MISSING);
    fireEvent.click(open);
    expect(await within(scope).findByText(NAVIGATION_ERROR_MESSAGES.FILE_MISSING)).toBeTruthy();
    expect(opened).toEqual([]);
    expect(await tuple()).toBeNull();
  });
});

describe("a bookmark draft keeps the content it was started on (M4S1-R6)", () => {
  async function startDraft(scope: HTMLElement) {
    fireEvent.click(within(scope).getByRole("button", { name: "Check pages" }));
    await within(scope).findByText("This PDF has 50 pages.");
    fireEvent.click(within(scope).getByRole("button", { name: "Add bookmark" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a bookmark" });
    fireEvent.change(within(dialog).getByLabelText("PDF page"), { target: { value: "4" } });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Draft for A" } });
    return dialog;
  }

  it("an open draft retains its original content after a background refresh", async () => {
    // Promoted from the frozen review diagnostic: the parent really refreshes
    // to B (same page count) while the dialog stays open.
    await seed();
    renderDetail();
    const scope = await panel();
    const dialog = await startDraft(scope);
    fileHash = B;
    // Another view (a source link elsewhere) checks the file in the background.
    await act(async () => {
      await sharedController!.openForGuidance(M, "Background refresh");
    });
    expect(await within(dialog).findByText(DRAFT_STALE_MESSAGE)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save bookmark" }));
    expect(await within(dialog).findByText(NAVIGATION_ERROR_MESSAGES.STALE_STATE)).toBeTruthy();
    expect(await db.select("SELECT * FROM material_bookmarks"), "the old draft does not bind itself to B").toEqual([]);
    expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value, "her typing is kept").toBe("Draft for A");
  });

  it("a replacement while the save itself is held is refused as stale", async () => {
    await seed();
    renderDetail();
    const scope = await panel();
    const dialog = await startDraft(scope);
    const held = gate();
    operationHeld = { kind: "add_bookmark", promise: held.promise };
    fireEvent.click(within(dialog).getByRole("button", { name: "Save bookmark" }));
    await within(dialog).findByRole("button", { name: "Saving…" });
    fileHash = B;
    await db.inspectNavigationIdentity!(M);
    held.resolve();
    expect(await within(dialog).findByText(NAVIGATION_ERROR_MESSAGES.STALE_STATE)).toBeTruthy();
    expect(await db.select("SELECT * FROM material_bookmarks")).toEqual([]);
  });

  it("an unchanged file saves the draft normally", async () => {
    await seed();
    renderDetail();
    const scope = await panel();
    const dialog = await startDraft(scope);
    await act(async () => {
      await sharedController!.openForGuidance(M, "Background refresh");
    });
    await within(scope).findByText("Background refresh");
    expect(within(dialog).queryByText(DRAFT_STALE_MESSAGE)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save bookmark" }));
    const list = await within(scope).findByRole("list", { name: "Bookmarks" });
    expect(within(list).getByText("Draft for A")).toBeTruthy();
    const [row] = await db.select<{ originating_content_sha256: string }>("SELECT * FROM material_bookmarks");
    expect(row!.originating_content_sha256).toBe(A);
  });

  it("a draft does not follow the panel to another material", async () => {
    await seed();
    await createRepositories(db).documents.create({ id: "other", title: "Other handbook", filePath: "other.pdf", originalFileName: "other.pdf", fileSize: 10 });
    const material = (id: string) => ({ id, title: id, filePath: `${id}.pdf` }) as StudyMaterial;
    const props = { fileMissing: false, restoring: false, onRestore: () => undefined };
    const view = render(h(AppDataProvider, null, h(DocumentPagesPanel, { material: material(M), ...props })));
    const scope = await panel();
    await startDraft(scope);
    view.rerender(h(AppDataProvider, null, h(DocumentPagesPanel, { material: material("other"), ...props })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a bookmark" })).toBeNull());
    view.rerender(h(AppDataProvider, null, h(DocumentPagesPanel, { material: material(M), ...props })));
    await panel();
    expect(screen.queryByRole("dialog", { name: "Add a bookmark" })).toBeNull();
    expect(await db.select("SELECT * FROM material_bookmarks")).toEqual([]);
  });
});

describe("source badges retire their guidance when the view goes away (M4S1-R8)", () => {
  it("leaving while the file is being checked opens nothing", async () => {
    await seed();
    const view = renderDetail();
    const badge = await screen.findByRole("button", { name: /Source p\. 12/ });
    const held = gate();
    inspectHeld = held.promise;
    fireEvent.click(badge);
    await waitFor(() => expect(screen.getByRole("button", { name: /Source p\. 12/ }).hasAttribute("disabled")).toBe(true));
    view.unmount();
    inspectHeld = null;
    held.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toEqual([]);
    expect(await tuple()).toBeNull();
  });
});
