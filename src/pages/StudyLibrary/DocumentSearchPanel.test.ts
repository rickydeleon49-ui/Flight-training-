// @vitest-environment jsdom
import { createElement as h, type ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchCoverage, SearchResponse } from "@/services/offlineContent";
import { makeMaterial } from "@/testing/factories";

const service = vi.hoisted(() => ({
  enabled: true,
  search: vi.fn<(q: string, ids: string[], offset: number, types?: readonly string[]) => Promise<SearchResponse>>(),
  verify: vi.fn<(id: string, sha: string) => Promise<"ok" | "changed" | "missing">>(),
}));
const nav = vi.hoisted(() => {
  const state = {
    request: vi.fn(),
    abort: vi.fn(),
    status: { kind: "idle", epoch: 0 } as { kind: string; epoch: number },
    controller: null as unknown,
  };
  // A stable controller object, as the real hook memoizes it.
  state.controller = {
    request: (...args: unknown[]) => state.request(...args),
    abort: () => state.abort(),
    status: () => state.status,
  };
  return state;
});

vi.mock("@/services/offlineContent", async (original) => {
  const real = await original<typeof import("@/services/offlineContent")>();
  return {
    ...real,
    offlineStudyEnabled: () => service.enabled,
    searchOfflineContent: (q: string, ids: string[], offset: number, types?: readonly string[]) =>
      service.search(q, ids, offset, types),
    verifyOfflineDestination: (id: string, sha: string) => service.verify(id, sha),
  };
});
const appData = vi.hoisted(() => ({
  data: { aiStudySets: [] as unknown[], notes: [] as unknown[], questions: [] as unknown[] },
}));
vi.mock("@/state/AppDataContext", () => ({
  useOptionalAppData: () => ({ data: appData.data }),
}));
vi.mock("@/state/navigation/useDocumentNavigation", () => ({
  useNavigationController: () => ({
    repo: null,
    controller: nav.controller,
    status: { kind: "idle", epoch: 0 },
  }),
  navigationMessage: () => "Couldn't open it.",
}));

import { OfflineSearchError } from "@/services/offlineContent";
import { itemDigest } from "@/logic/savedSearch";
import type { SavedSection } from "@/services/offlineContent";
import { appendGroups, appendSavedGroups, DocumentSearchPanel, SETUP_RETRY_MS, TYPING_PAUSE_MS } from "./DocumentSearchPanel";

const coverage = (over: Partial<SearchCoverage> = {}): SearchCoverage => ({
  searchedDocuments: 2,
  searchedPages: 30,
  imagePages: 0,
  otherUnsearchablePages: 0,
  notPrepared: 1,
  notChecked: 0,
  preparing: 0,
  couldNotPrepare: 0,
  missing: 0,
  notPdf: 0,
  ...over,
});
const sha = "a".repeat(64);
const response = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  groups: [
    {
      materialId: "m1",
      title: "Pilot's Handbook",
      materialType: "handbook",
      originalFileName: "phak.pdf",
      addedAt: "2026-10-19",
      passages: [{ contentSha256: sha, pageIndex: 58, snippet: "the \u{E000}crosswind\u{E001} <script>x</script> component" }],
    },
  ],
  coverage: coverage(),
  nextOffset: null,
  moreBeyondCap: false,
  trimmed: false,
  ...over,
});

const materials = [
  makeMaterial({ id: "m1", title: "Pilot's Handbook", filePath: "m1.pdf" }),
  makeMaterial({ id: "m2", title: "Notes", filePath: null }),
  makeMaterial({ id: "m3", title: "Weather", filePath: "m3.pdf" }),
];

/** Where the panel navigated to, if anywhere. */
function Location() {
  const location = useLocation();
  return h("output", { "data-testid": "location" }, `${location.pathname}${location.search}`);
}

function inRouter(element: ReactElement) {
  return h(MemoryRouter, { initialEntries: ["/study"] }, h(Routes, null, h(Route, { path: "*", element: h("div", null, element, h(Location)) })));
}

beforeEach(() => {
  appData.data = { aiStudySets: [], notes: [], questions: [] };
  vi.useFakeTimers({ shouldAdvanceTime: true });
  service.enabled = true;
  service.search.mockReset();
  service.verify.mockReset();
  nav.request.mockReset();
  nav.abort.mockReset();
  nav.status = { kind: "idle", epoch: 0 };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function typed() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(TYPING_PAUSE_MS);
  });
}

describe("Searching inside documents", () => {
  it("renders nothing and asks nothing when this build hasn't opted in, or with no words", async () => {
    service.enabled = false;
    const first = render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    expect(first.container.querySelector(".card")).toBeNull();
    first.unmount();
    service.enabled = true;
    const second = render(inRouter(h(DocumentSearchPanel, { query: "   ", materials })));
    await typed();
    expect(second.container.querySelector(".card")).toBeNull();
    expect(service.search).not.toHaveBeenCalled();
  });

  it("searches the filtered documents after a pause and shows grouped, highlighted text", async () => {
    service.search.mockResolvedValue(response());
    render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    expect(service.search).toHaveBeenCalledTimes(1);
    expect(service.search).toHaveBeenCalledWith("crosswind", ["m1", "m2", "m3"], 0, [
      "documentPages",
      "guides",
      "cards",
      "practice",
      "notes",
      "questions",
    ]);
    expect(await screen.findByText("Pilot's Handbook")).toBeTruthy();
    expect(screen.getByText("PDF page 58")).toBeTruthy();
    const mark = screen.getByText("crosswind");
    expect(mark.tagName).toBe("MARK");
    // Document text is text: the markup shows literally, nothing is parsed.
    expect(screen.getByText(/<script>x<\/script> component/)).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("Searched 2 documents (30 pages). 1 document isn't prepared for offline search yet.")).toBeTruthy();
  });

  it("says no match apart from not prepared", async () => {
    service.search.mockResolvedValue(response({ groups: [] }));
    render(inRouter(h(DocumentSearchPanel, { query: "zzqxv", materials })));
    await typed();
    expect(await screen.findByText("No matches in 2 documents (30 pages). 1 document isn't prepared for offline search yet.")).toBeTruthy();
  });

  it("uses only the newest answer while she keeps typing", async () => {
    let answerOld!: (r: SearchResponse) => void;
    service.search
      .mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)))
      .mockResolvedValue(response({ groups: [] }));
    const { rerender } = render(inRouter(h(DocumentSearchPanel, { query: "cross", materials })));
    await typed();
    rerender(inRouter(h(DocumentSearchPanel, { query: "crosswind landing", materials })));
    await typed();
    await screen.findByText(/No matches/);
    await act(async () => answerOld(response()));
    expect(screen.queryByText("Pilot's Handbook")).toBeNull();
  });

  it("waits while search is getting ready, then searches", async () => {
    service.search
      .mockRejectedValueOnce(new OfflineSearchError("index_preparing"))
      .mockResolvedValue(response());
    render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    expect(await screen.findByText("Getting offline search ready…")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETUP_RETRY_MS);
    });
    expect(await screen.findByText("Pilot's Handbook")).toBeTruthy();
    expect(service.search).toHaveBeenCalledTimes(2);
  });

  it("explains problems plainly and never shows a code", async () => {
    service.search.mockRejectedValue(new OfflineSearchError("timeout"));
    render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    expect(await screen.findByText("That search took too long. Try more specific words.")).toBeTruthy();
    expect(screen.queryByText(/timeout/)).toBeNull();
  });

  it("re-checks the file before opening, and opens at the page", async () => {
    service.search.mockResolvedValue(response());
    service.verify.mockResolvedValueOnce("changed").mockResolvedValue("ok");
    nav.request.mockResolvedValue({ kind: "saved", epoch: 1, materialId: "m1", destination: {}, readingState: {} });
    render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    const result = await screen.findByRole("button", { name: /Pilot's Handbook, PDF page 58/ });
    fireEvent.click(result);
    expect(await screen.findByText(/changed since you searched/)).toBeTruthy();
    expect(nav.request).not.toHaveBeenCalled();
    fireEvent.click(result);
    await waitFor(() => expect(nav.request).toHaveBeenCalledWith({ materialId: "m1", reference: 58, provenance: "physical_index" }));
    expect(service.verify).toHaveBeenLastCalledWith("m1", sha);
    expect(await screen.findByText(/Go to PDF page 58 there/)).toBeTruthy();
  });

  it("pages through more matches and moves between results with the arrow keys", async () => {
    const second = response().groups[0]!;
    service.search
      .mockResolvedValueOnce(response({ nextOffset: 20 }))
      .mockResolvedValue(response({ groups: [{ ...second, materialId: "m3", title: "Weather" }] }));
    render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    fireEvent.click(await screen.findByRole("button", { name: "Show more matches" }));
    expect(await screen.findByText("Weather")).toBeTruthy();
    expect(service.search).toHaveBeenLastCalledWith("crosswind", ["m1", "m2", "m3"], 20, ["documentPages"]);
    const [first, next] = screen.getAllByRole("button", { name: /open the document/ });
    first!.focus();
    fireEvent.keyDown(first!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(next!, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });

  it("clears results for other words or filters, even if the new search fails", async () => {
    service.search.mockResolvedValueOnce(response()).mockRejectedValue(new OfflineSearchError("timeout"));
    const { rerender } = render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    expect(await screen.findByText("Pilot's Handbook")).toBeTruthy();
    rerender(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials: materials.slice(1) })));
    expect(screen.queryByText("Pilot's Handbook")).toBeNull();
    await typed();
    expect(await screen.findByText(/took too long/)).toBeTruthy();
    expect(screen.queryByText("Pilot's Handbook")).toBeNull();
  });

  it("opens only the newest click, and nothing after leaving", async () => {
    const two = response({
      groups: [
        { ...response().groups[0]!, passages: [
          { contentSha256: sha, pageIndex: 1, snippet: "a" },
          { contentSha256: sha, pageIndex: 2, snippet: "b" },
        ] },
      ],
    });
    service.search.mockResolvedValue(two);
    let answerFirst!: (v: "ok") => void;
    service.verify.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve))).mockResolvedValueOnce("ok");
    nav.request.mockResolvedValue({ kind: "saved", epoch: 1, materialId: "m1", destination: {}, readingState: {} });
    const view = render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    const [first, second] = await screen.findAllByRole("button", { name: /open the document/ });
    fireEvent.click(first!);
    fireEvent.click(second!);
    await waitFor(() => expect(nav.request).toHaveBeenCalledTimes(1));
    expect(nav.request).toHaveBeenLastCalledWith({ materialId: "m1", reference: 2, provenance: "physical_index" });
    // The older click's check finishes last: it opens nothing.
    await act(async () => answerFirst("ok"));
    expect(nav.request).toHaveBeenCalledTimes(1);
    // A check that finishes after leaving the page opens nothing either.
    let answerLate!: (v: "ok") => void;
    service.verify.mockImplementationOnce(() => new Promise((resolve) => (answerLate = resolve)));
    fireEvent.click(first!);
    view.unmount();
    await act(async () => answerLate("ok"));
    expect(nav.request).toHaveBeenCalledTimes(1);
  });

  it("says the file couldn't be checked, not that it is missing, when checking fails", async () => {
    service.search.mockResolvedValue(response());
    service.verify.mockRejectedValue(new OfflineSearchError("storage_unavailable"));
    render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    fireEvent.click(await screen.findByRole("button", { name: /open the document/ }));
    expect(await screen.findByText(/Couldn't check this document's file just now/)).toBeTruthy();
    expect(screen.queryByText(/isn't on this Mac/)).toBeNull();
  });

  it("describes each result button with its passage", async () => {
    service.search.mockResolvedValue(response());
    render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    const button = await screen.findByRole("button", { name: /open the document/ });
    const described = document.getElementById(button.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toBe("the crosswind <script>x</script> component");
  });
});

describe("an open already handed to the navigation controller", () => {
  const two = () =>
    response({
      groups: [
        {
          ...response().groups[0]!,
          passages: [
            { contentSha256: sha, pageIndex: 1, snippet: "a" },
            { contentSha256: sha, pageIndex: 2, snippet: "b" },
          ],
        },
      ],
    });

  /** Start opening page 1 and hold the controller in its "checking" step. */
  async function holdFirstOpen(view: ReturnType<typeof render>) {
    service.verify.mockResolvedValue("ok");
    nav.request.mockImplementationOnce(() => {
      nav.status = { kind: "working", epoch: 7 };
      return new Promise(() => {});
    });
    await typed();
    const [first] = await view.findAllByRole("button", { name: /open the document/ });
    fireEvent.click(first!);
    await waitFor(() => expect(nav.request).toHaveBeenCalledTimes(1));
  }

  it("is retired by a newer click before that click's file check finishes", async () => {
    service.search.mockResolvedValue(two());
    const view = render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await holdFirstOpen(view);
    service.verify.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.click(view.getAllByRole("button", { name: /open the document/ })[1]!);
    expect(nav.abort).toHaveBeenCalledTimes(1);
  });

  it("is retired when the search changes", async () => {
    service.search.mockResolvedValue(two());
    const view = render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await holdFirstOpen(view);
    view.rerender(inRouter(h(DocumentSearchPanel, { query: "landing", materials })));
    expect(nav.abort).toHaveBeenCalledTimes(1);
  });

  it("is retired when she leaves the page", async () => {
    service.search.mockResolvedValue(two());
    const view = render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await holdFirstOpen(view);
    view.unmount();
    expect(nav.abort).toHaveBeenCalledTimes(1);
  });

  it("leaves someone else's request alone", async () => {
    service.search.mockResolvedValue(two());
    const view = render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await holdFirstOpen(view);
    // Another part of the app has since started its own request.
    nav.status = { kind: "working", epoch: 8 };
    view.unmount();
    expect(nav.abort).not.toHaveBeenCalled();
  });
});

describe("appendGroups", () => {
  it("merges a group the previous page trimmed instead of repeating it", () => {
    const g = (id: string, pages: number[]) => ({
      materialId: id,
      title: id,
      materialType: "handbook",
      originalFileName: null,
      addedAt: "",
      passages: pages.map((p) => ({ contentSha256: sha, pageIndex: p, snippet: String(p) })),
    });
    const merged = appendGroups([g("a", [1]), g("b", [4])], [g("b", [4, 5, 6]), g("c", [2])]);
    expect(merged.map((x) => [x.materialId, x.passages.map((p) => p.pageIndex)])).toEqual([
      ["a", [1]],
      ["b", [4, 5, 6]],
      ["c", [2]],
    ]);
  });
});

describe("saved study content", () => {
  const saved = (over: Partial<SavedSection> = {}): SavedSection => ({
    state: "ok",
    groups: [],
    coverage: { studySets: 1, practiceVersions: 0, notes: 2, questions: 0, tooLargeItems: 0 },
    nextOffset: null,
    moreBeyondCap: false,
    ...over,
  });

  it("shows a separate section, labelled as study aids, with what was searched", async () => {
    service.search.mockResolvedValue(
      response({
        saved: saved({
          groups: [
            { kind: "notes", materialId: null, title: "Your notes", passages: [{ kind: "note", recordId: "n1", rev: null, snippet: "\u{E000}crosswind\u{E001} chart" }] },
          ],
        }),
      }),
    );
    render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    expect(await screen.findByText("In your saved study content")).toBeTruthy();
    expect(screen.getByText("Searched your saved study content (1 study guide, 2 notes).")).toBeTruthy();
    expect(screen.getByText(/study aids\. Check them against FAA guidance and your instructor/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Your notes, Note: open it" })).toBeTruthy();
  });

  it("opens a note that still exists, and explains one that doesn't", async () => {
    appData.data = { aiStudySets: [], notes: [{ id: "n1" }], questions: [] };
    service.search.mockResolvedValue(
      response({
        saved: saved({
          groups: [
            {
              kind: "notes",
              materialId: null,
              title: "Your notes",
              passages: [
                { kind: "note", recordId: "gone", rev: null, snippet: "a" },
                { kind: "note", recordId: "n1", rev: null, snippet: "b" },
              ],
            },
          ],
        }),
      }),
    );
    render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    const [gone, kept] = await screen.findAllByRole("button", { name: "Your notes, Note: open it" });
    fireEvent.click(gone!);
    expect(await screen.findByText("That item isn't here any more.")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/study");
    fireEvent.click(kept!);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/notes?note=n1"));
  });

  it("opens a guide section only while its text is unchanged", async () => {
    const section = { heading: "Crosswind landings", body: "Use the wing-low method." };
    appData.data = {
      aiStudySets: [
        { sourceMaterialId: "m1", summary: "", sections: [section, { heading: "Regenerated", body: "Different text" }], flashcards: [] },
      ],
      notes: [],
      questions: [],
    };
    const rev = await itemDigest([section.heading, section.body]);
    const stale = await itemDigest(["Old heading", "Old body"]);
    service.search.mockResolvedValue(
      response({
        saved: saved({
          groups: [
            {
              kind: "material",
              materialId: "m1",
              title: "Pilot's Handbook",
              passages: [
                // Section 1 was regenerated after the search: same index, other text.
                { kind: "guide", recordId: "1", rev: stale, snippet: "old" },
                { kind: "summary", recordId: "summary", rev: "x", snippet: "summary" },
                { kind: "guide", recordId: "0", rev, snippet: "new" },
              ],
            },
          ],
        }),
      }),
    );
    render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    const buttons = await screen.findAllByRole("button", { name: /Pilot's Handbook, (Study guide|Guide summary): open it/ });
    fireEvent.click(buttons[0]!);
    expect(await screen.findByText("This study guide has changed since you searched. Search again to find it.")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/study");
    fireEvent.click(buttons[2]!);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(`/study/m1?guide=0&rev=${rev}`));
  });

  it("pages saved content on its own and says when it is too large", async () => {
    const note = (id: string) => ({ kind: "note" as const, recordId: id, rev: null, snippet: id });
    service.search
      .mockResolvedValueOnce(response({ saved: saved({ groups: [{ kind: "notes", materialId: null, title: "Your notes", passages: [note("n1")] }], nextOffset: 20 }) }))
      .mockResolvedValueOnce(response({ groups: [], saved: saved({ groups: [{ kind: "notes", materialId: null, title: "Your notes", passages: [note("n1"), note("n2")] }] }) }));
    const view = render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    fireEvent.click(await view.findByRole("button", { name: "Show more saved matches" }));
    await waitFor(() => expect(view.getAllByRole("button", { name: "Your notes, Note: open it" })).toHaveLength(2));
    expect(service.search).toHaveBeenLastCalledWith("crosswind", ["m1", "m2", "m3"], 20, ["guides", "cards", "practice", "notes", "questions"]);
    // The documents section is unchanged by saved paging.
    expect(view.getByText("Pilot's Handbook")).toBeTruthy();
    view.unmount();

    service.search.mockResolvedValue(response({ saved: saved({ state: "too_large" }) }));
    render(inRouter(h(DocumentSearchPanel, { query: "crosswind", materials })));
    await typed();
    expect(await screen.findByText("Your saved study content is too large to search offline in one go.")).toBeTruthy();
  });

  it("merges saved groups and items when a page repeats a trimmed group", () => {
    const g = (ids: string[]) => ({
      kind: "notes" as const,
      materialId: null,
      title: "Your notes",
      passages: ids.map((id) => ({ kind: "note" as const, recordId: id, rev: null, snippet: id })),
    });
    expect(appendSavedGroups([g(["a"])], [g(["a", "b"])])[0]!.passages.map((p) => p.recordId)).toEqual(["a", "b"]);
  });
});
