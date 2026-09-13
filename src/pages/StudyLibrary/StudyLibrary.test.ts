// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { AppData } from "@/state/AppDataContext";
import { makeAction, makeMaterial } from "@/testing/factories";

let data: AppData;
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data, mutate: async () => null }),
}));

import { StudyLibrary } from "./StudyLibrary";

beforeEach(() => {
  localStorage.clear();
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
