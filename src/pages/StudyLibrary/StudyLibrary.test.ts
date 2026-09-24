// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { AppData } from "@/state/AppDataContext";
import { makeAction, makeMaterial } from "@/testing/factories";

let data: AppData;
let mutateMock = vi.fn().mockResolvedValue(null);
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data, mutate: (...args: unknown[]) => mutateMock(...args) }),
}));

import { StudyLibrary } from "./StudyLibrary";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  localStorage.clear();
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
    goals: [], events: [],
  } as unknown as AppData;
});
afterEach(cleanup);

it("shows a bounded first page, loads more, and searches all materials", () => {
  render(h(MemoryRouter, null, h(StudyLibrary)));

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
