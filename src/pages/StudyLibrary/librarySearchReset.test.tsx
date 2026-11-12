// @vitest-environment jsdom
import { createElement as h, useEffect } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { AppData } from "@/state/AppDataContext";
import { makeMaterial } from "@/testing/factories";
import { isLibraryPath, useClearLibrarySearchOnLeave } from "./librarySearchReset";

let data: AppData;
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data, mutate: vi.fn().mockResolvedValue(null) }),
}));

vi.mock("./DocumentSearchPanel", () => ({
  DocumentSearchPanel: ({ onMatchesChange }: { onMatchesChange: (found: boolean) => void }) => {
    useEffect(() => onMatchesChange(false), [onMatchesChange]);
    return null;
  },
}));

import { StudyLibrary } from "./StudyLibrary";

// Stands in for the app shell: the hook and the navigation buttons sit above the routes.
function Shell() {
  useClearLibrarySearchOnLeave();
  const go = useNavigate();
  return h("div", null,
    h("button", { type: "button", onClick: () => go("/home") }, "Go home"),
    h("button", { type: "button", onClick: () => go("/study") }, "Go library"),
    h("button", { type: "button", onClick: () => go("/study/material-0") }, "Open material"),
    h(Routes, null,
      h(Route, { path: "/study", element: h(StudyLibrary) }),
      h(Route, { path: "/study/:materialId", element: h("p", null, "Material detail") }),
      h(Route, { path: "*", element: h("p", null, "Home page") }),
    ),
  );
}

function renderAt(path: string) {
  return render(h(MemoryRouter, { initialEntries: [path] }, h(Shell)));
}

function searchBox() {
  return screen.getByRole("textbox", { name: "Search your library" }) as HTMLInputElement;
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  localStorage.clear();
  sessionStorage.clear();
  data = {
    materials: [
      makeMaterial({ id: "material-0", title: "Aerodynamics basics" }),
      makeMaterial({ id: "material-1", title: "Weather briefing" }),
    ],
    actions: [],
    goals: [], events: [], aiStudySets: [], practiceTests: [],
  } as unknown as AppData;
});
afterEach(cleanup);

it("recognises the Library area as /study and anything under it", () => {
  expect(isLibraryPath("/study")).toBe(true);
  expect(isLibraryPath("/study/material-0")).toBe(true);
  expect(isLibraryPath("/home")).toBe(false);
  expect(isLibraryPath("/studyguide")).toBe(false);
});

it("leaving the Library and coming back shows an empty search and the full list", () => {
  renderAt("/study");
  fireEvent.change(searchBox(), { target: { value: "weather" } });
  expect(screen.queryByText("Aerodynamics basics")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Go home" }));
  expect(screen.getByText("Home page")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Go library" }));
  expect(searchBox().value).toBe("");
  expect(screen.getByText("Aerodynamics basics")).toBeTruthy();
  expect(screen.getByText("Weather briefing")).toBeTruthy();
});

it("keeps the search when moving to a material and back to the list", () => {
  renderAt("/study");
  fireEvent.change(searchBox(), { target: { value: "weather" } });

  fireEvent.click(screen.getByRole("button", { name: "Open material" }));
  expect(screen.getByText("Material detail")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Go library" }));
  expect(searchBox().value).toBe("weather");
});
