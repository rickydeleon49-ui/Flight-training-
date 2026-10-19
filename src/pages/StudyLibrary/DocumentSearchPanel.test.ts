// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchCoverage, SearchResponse } from "@/services/offlineContent";
import { makeMaterial } from "@/testing/factories";

const service = vi.hoisted(() => ({
  enabled: true,
  search: vi.fn<(q: string, ids: string[], offset: number) => Promise<SearchResponse>>(),
  verify: vi.fn<(id: string, sha: string) => Promise<"ok" | "changed" | "missing">>(),
}));
const nav = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/services/offlineContent", async (original) => {
  const real = await original<typeof import("@/services/offlineContent")>();
  return {
    ...real,
    offlineStudyEnabled: () => service.enabled,
    searchOfflineContent: (q: string, ids: string[], offset: number) => service.search(q, ids, offset),
    verifyOfflineDestination: (id: string, sha: string) => service.verify(id, sha),
  };
});
vi.mock("@/state/navigation/useDocumentNavigation", () => ({
  useNavigationController: () => ({ repo: null, controller: { request: nav.request }, status: { kind: "idle", epoch: 0 } }),
  navigationMessage: () => "Couldn't open it.",
}));

import { OfflineSearchError } from "@/services/offlineContent";
import { appendGroups, DocumentSearchPanel, SETUP_RETRY_MS, TYPING_PAUSE_MS } from "./DocumentSearchPanel";

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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  service.enabled = true;
  service.search.mockReset();
  service.verify.mockReset();
  nav.request.mockReset();
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
    const first = render(h(DocumentSearchPanel, { query: "crosswind", materials }));
    await typed();
    expect(first.container.innerHTML).toBe("");
    first.unmount();
    service.enabled = true;
    const second = render(h(DocumentSearchPanel, { query: "   ", materials }));
    await typed();
    expect(second.container.innerHTML).toBe("");
    expect(service.search).not.toHaveBeenCalled();
  });

  it("searches the filtered documents after a pause and shows grouped, highlighted text", async () => {
    service.search.mockResolvedValue(response());
    render(h(DocumentSearchPanel, { query: "crosswind", materials }));
    await typed();
    expect(service.search).toHaveBeenCalledTimes(1);
    expect(service.search).toHaveBeenCalledWith("crosswind", ["m1", "m3"], 0);
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
    render(h(DocumentSearchPanel, { query: "zzqxv", materials }));
    await typed();
    expect(await screen.findByText("No matches in 2 documents (30 pages). 1 document isn't prepared for offline search yet.")).toBeTruthy();
  });

  it("uses only the newest answer while she keeps typing", async () => {
    let answerOld!: (r: SearchResponse) => void;
    service.search
      .mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)))
      .mockResolvedValue(response({ groups: [] }));
    const { rerender } = render(h(DocumentSearchPanel, { query: "cross", materials }));
    await typed();
    rerender(h(DocumentSearchPanel, { query: "crosswind landing", materials }));
    await typed();
    await screen.findByText(/No matches/);
    await act(async () => answerOld(response()));
    expect(screen.queryByText("Pilot's Handbook")).toBeNull();
  });

  it("waits while search is getting ready, then searches", async () => {
    service.search
      .mockRejectedValueOnce(new OfflineSearchError("index_preparing"))
      .mockResolvedValue(response());
    render(h(DocumentSearchPanel, { query: "crosswind", materials }));
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
    render(h(DocumentSearchPanel, { query: "crosswind", materials }));
    await typed();
    expect(await screen.findByText("That search took too long. Try more specific words.")).toBeTruthy();
    expect(screen.queryByText(/timeout/)).toBeNull();
  });

  it("re-checks the file before opening, and opens at the page", async () => {
    service.search.mockResolvedValue(response());
    service.verify.mockResolvedValueOnce("changed").mockResolvedValue("ok");
    nav.request.mockResolvedValue({ kind: "saved", epoch: 1, materialId: "m1", destination: {}, readingState: {} });
    render(h(DocumentSearchPanel, { query: "crosswind", materials }));
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
    render(h(DocumentSearchPanel, { query: "crosswind", materials }));
    await typed();
    fireEvent.click(await screen.findByRole("button", { name: "Show more matches" }));
    expect(await screen.findByText("Weather")).toBeTruthy();
    expect(service.search).toHaveBeenLastCalledWith("crosswind", ["m1", "m3"], 20);
    const [first, next] = screen.getAllByRole("button", { name: /open the document/ });
    first!.focus();
    fireEvent.keyDown(first!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(next!, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });

  it("clears results for other words or filters, even if the new search fails", async () => {
    service.search.mockResolvedValueOnce(response()).mockRejectedValue(new OfflineSearchError("timeout"));
    const { rerender } = render(h(DocumentSearchPanel, { query: "crosswind", materials }));
    await typed();
    expect(await screen.findByText("Pilot's Handbook")).toBeTruthy();
    rerender(h(DocumentSearchPanel, { query: "crosswind", materials: materials.slice(1) }));
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
    const view = render(h(DocumentSearchPanel, { query: "crosswind", materials }));
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
    render(h(DocumentSearchPanel, { query: "crosswind", materials }));
    await typed();
    fireEvent.click(await screen.findByRole("button", { name: /open the document/ }));
    expect(await screen.findByText(/Couldn't check this document's file just now/)).toBeTruthy();
    expect(screen.queryByText(/isn't on this Mac/)).toBeNull();
  });

  it("describes each result button with its passage", async () => {
    service.search.mockResolvedValue(response());
    render(h(DocumentSearchPanel, { query: "crosswind", materials }));
    await typed();
    const button = await screen.findByRole("button", { name: /open the document/ });
    const described = document.getElementById(button.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toBe("the crosswind <script>x</script> component");
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
