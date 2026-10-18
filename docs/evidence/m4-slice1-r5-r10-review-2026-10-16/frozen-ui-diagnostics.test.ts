// @vitest-environment jsdom
/**
 * M4 Slice 1 interface: the material pages panel and the source badges in the
 * real MaterialDetail, inside AppDataProvider over a disposable node:sqlite
 * database with the real navigation transaction. The desktop inspector and
 * verified opener are stand-ins on that database (they record what they were
 * asked); no real file, reader, profile, provider or network is used.
 */
import { createElement as h } from "react";
import { useNavigationController, useMaterialNavigation } from "@/state/navigation/useDocumentNavigation";
let observedController: any;
let observedNav: any;
function ReviewProbe() { const value = useNavigationController(); observedController = value.controller; observedNav = useMaterialNavigation(M, value.repo, value.status); return null; }
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InspectedNavigationIdentity } from "@/domain/types";
import { NAVIGATION_ERROR_MESSAGES, NavigationError } from "@/data/navigationTransaction";
import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider } from "@/state/AppDataContext";

import { MaterialDetail } from "../MaterialDetail";

let db: TestDatabase;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

const M = "nav-material";
const A = "a".repeat(64);
const B = "b".repeat(64);

let fileHash: string;
let inspectFails: unknown;
let commitFails: unknown;
let opened: { materialId: string; hash: string }[];

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
    if (inspectFails) throw inspectFails;
    await db.execute(
      `INSERT INTO material_content_identities VALUES (?, ?, 50, 'x')
       ON CONFLICT(material_id) DO UPDATE SET content_sha256 = excluded.content_sha256`,
      [materialId, fileHash],
    );
    return { materialId, contentSha256: fileHash, totalPages: 50, verifiedAt: "x", changed: false };
  };
  db.openNavigationDocument = async (materialId, hash) => {
    if (hash !== fileHash) throw new NavigationError("FILE_CHANGED", NAVIGATION_ERROR_MESSAGES.FILE_CHANGED);
    opened.push({ materialId, hash });
  };
  const operation = db.navigationOperation!.bind(db);
  db.navigationOperation = (async (op: Parameters<typeof operation>[0]) => {
    if (op.kind === "commit" && commitFails) {
      const error = commitFails;
      commitFails = undefined;
      throw error;
    }
    return operation(op);
  }) as typeof db.navigationOperation;
}

function renderDetail() {
  return render(
    h(
      AppDataProvider,
      null,
      h(ReviewProbe),
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

async function openAt(scope: HTMLElement, page: string) {
  fireEvent.change(within(scope).getByLabelText("PDF page"), { target: { value: page } });
  fireEvent.click(within(scope).getByRole("button", { name: "Open at page" }));
}

beforeEach(() => {
  fileHash = A;
  inspectFails = undefined;
  commitFails = undefined;
  opened = [];
});

afterEach(() => {
  cleanup();
  db?.close();
});

describe("the pages panel", () => {
  it("opens at a physical page, records only that it was asked for, and reads separately", async () => {
    await seed();
    renderDetail();
    const scope = await panel();
    await openAt(scope, "12");
    expect(await within(scope).findByText(/Opened in your PDF reader\. Go to PDF page 12 there; your reader may not jump to it by itself\./)).toBeTruthy();
    expect(opened).toEqual([{ materialId: M, hash: A }]);
    await within(scope).findByText(/Last page you asked to open/);
    expect(await tuple()).toEqual([12, 0, A, "active", 1]);

    const read = within(scope).getByRole("checkbox", { name: /I've read this page/ }) as HTMLInputElement;
    expect(read.checked).toBe(false);
    fireEvent.click(read);
    await waitFor(async () => expect(await tuple()).toEqual([12, 1, A, "active", 1]));
    await waitFor(() => expect((within(scope).getByRole("checkbox", { name: /I've read this page/ }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(within(scope).getByRole("checkbox", { name: /I've read this page/ }));
    await waitFor(async () => expect(await tuple()).toEqual([12, 0, A, "active", 1]));
  });

  it("refuses a page past the end or not a number, with an explanation, and opens nothing", async () => {
    await seed();
    renderDetail();
    const scope = await panel();
    await openAt(scope, "abc");
    expect(await within(scope).findByText("Enter a whole page number, like 12.")).toBeTruthy();
    await openAt(scope, "51");
    expect(await within(scope).findByText("This document has 50 pages, so there is no page 51.")).toBeTruthy();
    expect(opened).toEqual([]);
    expect(await tuple()).toBeNull();
  });

  it("a failed save offers a save-only retry that does not reopen the file", async () => {
    await seed();
    renderDetail();
    const scope = await panel();
    commitFails = new NavigationError("STORAGE_FAILURE", NAVIGATION_ERROR_MESSAGES.STORAGE_FAILURE);
    await openAt(scope, "7");
    const retry = await within(scope).findByRole("button", { name: "Try saving again" });
    expect(within(scope).getByText(/Opened, but the page wasn't saved/)).toBeTruthy();
    expect(await tuple()).toBeNull();
    fireEvent.click(retry);
    expect(await within(scope).findByText(/Go to PDF page 7 there/)).toBeTruthy();
    expect(await tuple()).toEqual([7, 0, A, "active", 1]);
    expect(opened).toHaveLength(1);
  });

  it("a missing file explains itself and keeps restore reachable", async () => {
    await seed();
    renderDetail();
    const scope = await panel();
    inspectFails = new NavigationError("FILE_MISSING", NAVIGATION_ERROR_MESSAGES.FILE_MISSING);
    await openAt(scope, "3");
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

    fireEvent.click(within(list).getByRole("button", { name: /Open Airspace chart at PDF page 9/ }));
    expect(await within(scope).findByText(/Go to PDF page 9 \(printed page 3-12\) there/)).toBeTruthy();

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
    expect(await screen.findByText(/The study aid points to page 12, which may be the page number printed in the book/)).toBeTruthy();
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
    expect(within(scope).getByText(/Opening a file at a page needs the desktop app/)).toBeTruthy();
    expect(within(scope).queryByRole("button", { name: "Open at page" })).toBeNull();
  });

  it("without a cited page the badge still says to check the source", async () => {
    await seed({ cards: [{ front: "Q", back: "A", sourcePage: null }] as never });
    renderDetail();
    expect(await screen.findByText("Check source")).toBeTruthy();
  });
});


describe("reviewer content-binding diagnostics", () => {
  it("[R5] opening a saved A bookmark must not silently target replacement B", async () => {
    await seed(); renderDetail(); const scope = await panel();
    fireEvent.click(within(scope).getByRole("button", {name:"Check pages"}));
    await within(scope).findByText("This PDF has 50 pages.");
    await db.navigationOperation!({kind:"add_bookmark", materialId:M, expectedContentSha256:A, bookmarkId:"saved-a", physicalPage:9, pageLabel:"A-label", title:"Saved A", notes:""});
    await observedController.openForGuidance(M,"Refresh A");
    const list = await within(scope).findByRole("list", {name:"Bookmarks"});
    const open = await within(list).findByRole("button", {name:/Open Saved A at PDF page 9/});
    opened=[]; fileHash=B;
    const inspect=db.inspectNavigationIdentity!.bind(db);
    db.inspectNavigationIdentity=async (id)=>{const value=await inspect(id); await db.execute("UPDATE material_bookmarks SET status='drifted' WHERE originating_content_sha256 <> ?",[value.contentSha256]); return value;};
    fireEvent.click(open);
    await waitFor(()=>expect(observedController.status().kind).not.toBe("working"));
    expect(opened,"A bookmark must not open B").toEqual([]);
    expect(await tuple(),"do not save its old coordinate against B").toBeNull();
  });
  it("[R6] an open bookmark draft must retain its original content after a background refresh", async () => {
    await seed(); renderDetail(); const scope=await panel();
    fireEvent.click(within(scope).getByRole("button", {name:"Check pages"}));
    await within(scope).findByText("This PDF has 50 pages.");
    fireEvent.click(within(scope).getByRole("button",{name:"Add bookmark"}));
    const dialog=await screen.findByRole("dialog",{name:"Add a bookmark"});
    fireEvent.change(within(dialog).getByLabelText("PDF page"),{target:{value:"4"}});
    fireEvent.change(within(dialog).getByLabelText("Name"),{target:{value:"Draft for A"}});
    fileHash=B;
    await observedController.openForGuidance(M,"Background refresh B");
    await waitFor(()=>expect(observedNav.state?.identity?.contentSha256).toBe(B));
    fireEvent.click(within(dialog).getByRole("button",{name:"Save bookmark"}));
    await waitFor(()=>expect(screen.queryByRole("button",{name:"Saving…"})).toBeNull());
    expect(await db.select("SELECT * FROM material_bookmarks"),"old draft must not bind itself to B").toEqual([]);
  });
});
