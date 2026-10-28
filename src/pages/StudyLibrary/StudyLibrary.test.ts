// @vitest-environment jsdom
import { createElement as h, useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { AppData } from "@/state/AppDataContext";
import { makeAction, makeMaterial } from "@/testing/factories";

let data: AppData;
let mutateMock = vi.fn().mockResolvedValue(null);
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data, mutate: (...args: unknown[]) => mutateMock(...args) }),
}));

// Exercise the library's response to the content panel without native search.
const contentSearch = vi.hoisted(() => ({ hasMatches: false }));
vi.mock("./DocumentSearchPanel", () => ({
  DocumentSearchPanel: ({ query, onMatchesChange }: { query: string; onMatchesChange: (found: boolean) => void }) => {
    useEffect(() => onMatchesChange(contentSearch.hasMatches), [query, onMatchesChange]);
    return contentSearch.hasMatches ? h("p", null, "Content search hit") : null;
  },
}));

import { StudyLibrary } from "./StudyLibrary";

beforeEach(() => {
  contentSearch.hasMatches = false;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  localStorage.clear();
  // The search box is remembered for the session; a test must not inherit it.
  sessionStorage.clear();
  mutateMock.mockReset().mockResolvedValue(null);
  const materials = Array.from({ length: 150 }, (_, index) =>
    makeMaterial({ id: `material-${index}`, title: `Material ${index}` }),
  );
  data = {
    materials,
    actions: [
      makeAction({ relatedType: "material", relatedId: "material-0", title: "First step" }),
      makeAction({ relatedType: "material", relatedId: "material-0", title: "Later step" }),
    ],
    goals: [], events: [], aiStudySets: [], practiceTests: [],
  } as unknown as AppData;
});
afterEach(cleanup);

it("shows a bounded first page, loads more, and searches all materials", () => {
  render(h(MemoryRouter, null, h(StudyLibrary)));

  expect((screen.getByRole("button", { name: "Export handout…" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Material 0")).toBeTruthy();
  expect(screen.queryByText("Material 149")).toBeNull();
  expect(screen.getByText("Showing 100 of 150 materials")).toBeTruthy();
  expect(screen.getByText("Next: First step")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show 100 more materials" }));
  expect(screen.getByText("Material 149")).toBeTruthy();

  fireEvent.change(screen.getByRole("textbox", { name: "Search your library" }), {
    target: { value: "Material 149" },
  });
  expect(screen.getByText("Showing 1 of 1 materials")).toBeTruthy();
  expect(screen.getByText("Material 149")).toBeTruthy();
  expect(screen.queryByText("Material 0")).toBeNull();

  fireEvent.change(screen.getByRole("textbox", { name: "Search your library" }), {
    target: { value: "" },
  });
  expect(screen.getByText("Showing 100 of 150 materials")).toBeTruthy();
  expect(screen.queryByText("Material 149")).toBeNull();
});

it("opens the export center when study content is available", () => {
  data.aiStudySets = [{
    sourceMaterialId: "material-0",
    title: "Weather",
    summary: "Weather summary",
    sections: [],
    flashcards: [{ front: "BKN?", back: "Broken", sourcePage: null }],
    sourceNotes: "",
    provider: "manual",
    model: "",
    generatedAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
  }];
  render(h(MemoryRouter, null, h(StudyLibrary)));
  const button = screen.getByRole("button", { name: "Export handout…" }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(screen.getByRole("dialog", { name: "Export study materials" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Material 0" })).toBeTruthy();
});

it("opens add material dialog and closes it when creation succeeds", async () => {
  mutateMock.mockImplementation(async (callback: (repos: { documents: { create: ReturnType<typeof vi.fn> } }) => unknown) => {
    return callback({
      documents: {
        create: vi.fn().mockResolvedValue(makeMaterial({ id: "new-mat", title: "New Handout" })),
      },
    });
  });

  render(h(MemoryRouter, null, h(StudyLibrary)));

  fireEvent.click(screen.getByRole("button", { name: /Add material/i }));
  const dialog = screen.getByRole("dialog", { name: "Add to your library" });
  expect(dialog).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Handout" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add material" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

/** The library's own address, so a test can see what a hand-off left behind. */
function LibraryAddress() {
  const [params] = useSearchParams();
  return h("output", { "aria-label": "Address" }, params.toString());
}

it("takes the words Quick Find hands over (?q=) into the search box and off the address", () => {
  render(h(MemoryRouter, { initialEntries: ["/study?q=crankshaft"] }, h(LibraryAddress), h(StudyLibrary)));

  const box = screen.getByRole("textbox", { name: "Search your library" }) as HTMLInputElement;
  expect(box.value).toBe("crankshaft");
  // The hand-off really filters, which is also what searches the PDF pages.
  expect(screen.queryByText("Material 0")).toBeNull();
  expect(screen.getByText("Nothing matches those filters.")).toBeTruthy();
  expect(screen.getByLabelText("Address").textContent).toBe("");

  // Typing from here still works: the address no longer overrides the box.
  fireEvent.change(box, { target: { value: "Material 149" } });
  expect(screen.getByText("Showing 1 of 1 materials")).toBeTruthy();
});

for (const storedDash of ["-", "–", "—", "−"]) {
  it(`finds page ranges with any dash without changing the ${storedDash} title`, () => {
    const title = `00_afh_full — Pages 120${storedDash}150`;
    data.materials = [makeMaterial({ id: "range", title }), makeMaterial({ id: "other", title: "Other material" })];
    render(h(MemoryRouter, null, h(StudyLibrary)));
    for (const queryDash of ["-", "–", "—", "−"]) {
      fireEvent.change(screen.getByRole("textbox", { name: "Search your library" }), { target: { value: `Pages 120${queryDash}150` } });
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.queryByText("Other material")).toBeNull();
      expect(data.materials[0]!.title).toBe(title);
    }
    expect(mutateMock).not.toHaveBeenCalled();
  });
}

it("PACKS-04 disables automatic corrections in the Study Library search box", () => {
  render(h(MemoryRouter, null, h(StudyLibrary)));
  const box = screen.getByRole("textbox", { name: "Search your library" });
  for (const attribute of ["autocomplete", "autocorrect", "autocapitalize"]) expect(box.getAttribute(attribute)).toBe("off");
  expect(box.getAttribute("spellcheck")).toBe("false");
});


it("PACKS-05 omits the material empty card when content hits answer the search, and restores it for no hits", () => {
  contentSearch.hasMatches = true;
  render(h(MemoryRouter, null, h(StudyLibrary)));
  const box = screen.getByRole("textbox", { name: "Search your library" });
  fireEvent.change(box, { target: { value: "rudder" } });
  expect(screen.getByText("Content search hit")).toBeTruthy();
  expect(screen.queryByText("Material 0")).toBeNull();
  expect(screen.queryByText("No study materials match.")).toBeNull();
  expect(screen.queryByText("Nothing matches those filters.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();

  // Material matches still render alongside content matches.
  fireEvent.change(box, { target: { value: "Material 149" } });
  expect(screen.getByText("Material 149")).toBeTruthy();
  expect(screen.getByText("Showing 1 of 1 materials")).toBeTruthy();
  expect(screen.getByText("Content search hit")).toBeTruthy();

  // A later search without either kind of match keeps the usual recovery.
  contentSearch.hasMatches = false;
  fireEvent.change(box, { target: { value: "zzqx" } });
  expect(screen.queryByText("Content search hit")).toBeNull();
  expect(screen.getByText("Nothing matches those filters.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByText("Material 0")).toBeTruthy();
});
