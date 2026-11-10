// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_DATA } from "@/state/AppDataContext";
import { expectNoA11yViolations } from "@/testing/a11y";
import { More } from "@/pages/More/More";
import { AppShell } from "./AppShell";

const mocks = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/components/gemini/GeminiOrphanNotices", () => ({ GeminiOrphanNotices: () => null }));
vi.mock("@/state/AppDataContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAppData: () => ({
    data: mocks.data,
    dataRevision: 1,
    repositories: null,
    pendingDelete: null,
    undoDelete: vi.fn(),
    refresh: vi.fn(),
    mutate: vi.fn().mockResolvedValue({ ok: true }),
  }),
}));

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
let history: string[] = [];
function Probe() {
  const location = useLocation();
  const type = useNavigationType();
  history.push(`${type}:${location.pathname}`);
  return null;
}
function mount(path: string, width = 390, ua = IPHONE) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  const media = { matches: width >= 1000, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  history = [];
  return render(h(MemoryRouter, { initialEntries: [path] }, h(Probe),
    h(Routes, null, h(Route, { element: h(AppShell) },
      h(Route, { path: "more", element: h(More) }),
      h(Route, { path: "*", element: h("p", null, "page") })))));
}
const tab = (name: RegExp | string) => screen.getByRole("link", { name });

beforeEach(() => { mocks.data = EMPTY_DATA; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("iPhone tab bar", () => {
  it("shows five tabs and no Menu or sidebar", () => {
    mount("/");
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
    expect(document.querySelector(".sidebar")).toBeNull();
    expect(document.querySelector(".shell--tabs")).toBeTruthy();
    for (const name of ["Home", "Study", "Schedule", "Log", "More"]) expect(tab(name)).toBeTruthy();
    expect(tab("Home").getAttribute("aria-current")).toBe("page");
  });

  it("the active tab icon has the heavier stroke", () => {
    mount("/study");
    const w = (name: string) => tab(name).querySelector("svg")?.getAttribute("stroke-width");
    expect(w("Study")).toBe("2.25");
    for (const n of ["Home", "Schedule", "Log", "More"]) expect(w(n)).toBe("1.75");
    expect(tab("Study").getAttribute("aria-current")).toBe("page");
    expect(tab("Home").getAttribute("aria-current")).toBeNull();
  });

  it("a wide iPad keeps the sidebar and has no tab bar", () => {
    mount("/", 1200);
    expect(document.querySelector(".ios-tab-bar")).toBeNull();
    expect(document.querySelector(".sidebar")).toBeTruthy();
    expect(document.querySelector(".shell--tabs")).toBeNull();
  });

  it("shows a back button only on the iPhone", () => {
    mount("/study/m-1");
    expect(screen.getByRole("button", { name: "Back to Study" })).toBeTruthy();
    cleanup();
    mount("/study/m-1", 644, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
    cleanup();
    mount("/study/m-1", 1200);
    expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
  });

  it("a Mac keeps the sidebar and menu", () => {
    mount("/", 644, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(document.querySelector(".ios-tab-bar")).toBeNull();
    expect(screen.getByRole("button", { name: "Menu" })).toBeTruthy();
  });

  it("re-tapping the active tab scrolls to top without adding history", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    mount("/");
    const before = history.length;
    fireEvent.click(tab("Home"));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(history.length).toBe(before);
  });

  it("tapping another tab navigates", () => {
    mount("/");
    fireEvent.click(tab("Study"));
    expect(history.at(-1)).toBe("PUSH:/study");
  });

  it.each(["/settings", "/flight-path/skills/x", "/questions", "/notes", "/finances", "/toolkit", "/more"])(
    "marks More active on %s",
    (path) => {
      mount(path);
      expect(tab("More").getAttribute("aria-current")).toBe("page");
      expect(tab("Home").getAttribute("aria-current")).toBeNull();
    },
  );

  it("shows overdue and to-ask badges", () => {
    mocks.data = {
      ...EMPTY_DATA,
      questions: [{ id: "q", status: "to_ask" }],
      actions: [{ id: "a", status: "open", dueDate: "2000-01-01" }],
    };
    mount("/");
    expect(tab(/^Home/).textContent).toMatch(/1 overdue/);
    expect(tab(/^More/).textContent).toMatch(/1 to ask/);
  });

  it("passes the accessibility check with a single Main landmark", async () => {
    const { container } = mount("/more");
    expect(screen.getAllByRole("navigation", { name: "Main" }).length).toBe(1);
    await expectNoA11yViolations(container);
  });
});

describe("More page", () => {
  it("lists every remaining page and reaches Settings", () => {
    mount("/more");
    for (const name of ["Flight Path", "Questions", "Notes", "Finances", "Pilot Toolkit", "Settings"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(history.at(-1)).toBe("PUSH:/settings");
  });

  it("Search opens Quick Find", () => {
    const open = vi.fn();
    window.addEventListener("quickfind:open", open);
    mount("/more");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(open).toHaveBeenCalled();
    window.removeEventListener("quickfind:open", open);
  });
});
