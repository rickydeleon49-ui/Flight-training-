// @vitest-environment jsdom
// Disclosure behavior lives here; real keyboard activation and geometry are
// checked by .claude/tests/narrow-layout.browser.mjs, since jsdom has no layout.
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_DATA } from "@/state/AppDataContext";
import { AppShell } from "./AppShell";

vi.mock("@/components/gemini/GeminiOrphanNotices", () => ({ GeminiOrphanNotices: () => null }));
vi.mock("@/state/AppDataContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAppData: () => ({
    data: EMPTY_DATA,
    dataRevision: 1,
    repositories: null,
    pendingDelete: null,
    undoDelete: vi.fn(),
    refresh: vi.fn(),
    mutate: vi.fn().mockResolvedValue({ ok: true }),
  }),
}));

let navTo: ReturnType<typeof useNavigate>;
let media: MediaQueryList;
const listeners = new Set<() => void>();
function NavProbe() { navTo = useNavigate(); return null; }
function mount(width = 644) {
  Object.defineProperty(media, "matches", { configurable: true, value: width >= 1000 });
  render(h(MemoryRouter, { initialEntries: ["/"] }, h(NavProbe),
    h(Routes, null, h(Route, { path: "*", element: h(AppShell) }))));
}
function resize(width: number) {
  act(() => {
    Object.defineProperty(media, "matches", { configurable: true, value: width >= 1000 });
    listeners.forEach((listener) => listener());
  });
}
const menu = () => screen.getByRole("button", { name: "Menu" });
const sections = ["Flight Deck", "Flight Path", "Study Library", "Schedule", "Flight Log",
  "Questions", "Notes", "Finances", "Pilot Toolkit", "Settings"];

beforeEach(() => {
  media = {
    matches: false,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  } as unknown as MediaQueryList;
  vi.stubGlobal("matchMedia", vi.fn((query) => query === "(min-width: 1000px)" ? media : { matches: false }));
});
afterEach(() => {
  cleanup();
  expect(listeners.size).toBe(0);
  vi.unstubAllGlobals();
});

describe("AppShell navigation disclosure", () => {
  it.each([644, 900, 999])("starts closed at %i with a native, focusable Menu button and hidden navigation", (width) => {
    mount(width);
    expect(menu().tagName).toBe("BUTTON");
    expect(menu().getAttribute("type")).toBe("button");
    menu().focus();
    expect(document.activeElement).toBe(menu());
    expect(menu().tabIndex).toBe(0);
    expect(menu().getAttribute("aria-expanded")).toBe("false");
    const controlled = document.getElementById(menu().getAttribute("aria-controls")!);
    expect(controlled?.hidden).toBe(true);
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Search/ })).toBeNull();
    fireEvent.click(menu());
    expect(menu().getAttribute("aria-expanded")).toBe("true");
    expect(controlled?.hidden).toBe(false);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(sections);
    expect(screen.getByRole("button", { name: /^Search/ })).toBeTruthy();
    fireEvent.click(menu());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("closes on every section selection, including the current route and Settings, and preserves active links", () => {
    mount();
    for (const section of sections) {
      fireEvent.click(menu());
      const link = screen.getByRole("link", { name: section });
      link.focus();
      fireEvent.click(link);
      expect(menu().getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(menu());
      expect(screen.queryByRole("link")).toBeNull();
      fireEvent.click(menu());
      const active = screen.getByRole("link", { name: section });
      expect(active.getAttribute("aria-current")).toBe("page");
      expect(active.classList.contains("is-active")).toBe(true);
      fireEvent.click(menu());
    }
  });

  it("closes on navigation from outside the menu, such as history or a search result", () => {
    mount();
    fireEvent.click(menu());
    screen.getByRole("link", { name: "Notes" }).focus();
    act(() => { void navTo("/study"); });
    expect(menu().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menu());
    fireEvent.click(menu());
    expect(screen.getByRole("link", { name: "Study Library" }).getAttribute("aria-current")).toBe("page");
  });

  it("opens Quick Find through Search and through the keyboard shortcut with the menu closed", () => {
    mount();
    fireEvent.click(menu());
    fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
    expect(screen.getByRole("textbox", { name: "Search everything" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search everything" }), { key: "Escape" });
    fireEvent.click(menu());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("textbox", { name: "Search everything" })).toBeTruthy();
  });

  it("closes the disclosure after choosing a real Quick Find route result", () => {
    mount();
    fireEvent.click(menu());
    const search = screen.getByRole("button", { name: /^Search/ });
    search.focus();
    fireEvent.click(search);
    fireEvent.click(screen.getByRole("button", { name: /^Study LibraryMaterials/ }));
    expect(screen.queryByRole("textbox", { name: "Search everything" })).toBeNull();
    expect(menu().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menu());
  });

  it("keeps desktop active navigation in view without scrolling the narrow disclosure", () => {
    const original = Element.prototype.scrollIntoView;
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      mount(1320);
      expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
      scroll.mockClear();
      act(() => { void navTo("/study"); });
      expect(scroll).toHaveBeenCalledOnce();
      scroll.mockClear();
      resize(644);
      fireEvent.click(menu());
      expect(scroll).not.toHaveBeenCalled();
    } finally { Element.prototype.scrollIntoView = original; }
  });

  it.each([1000, 1320])("keeps the desktop sidebar visible at %i and resets the disclosure when resized", (width) => {
    mount(width);
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(sections.length);
    screen.getByRole("link", { name: "Settings" }).focus();
    resize(644);
    expect(document.activeElement).toBe(menu());
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(menu());
    menu().focus();
    resize(width);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Search/ }));
    expect(screen.getAllByRole("link")).toHaveLength(sections.length);
    resize(644);
    expect(menu().getAttribute("aria-expanded")).toBe("false");
  });
});
