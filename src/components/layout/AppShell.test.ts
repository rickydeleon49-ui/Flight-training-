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

  it.each(["button", "Control shortcut", "Command shortcut"])("closes the narrow Menu before Quick Find opens via %s and returns focus to Menu", (entry) => {
    mount();
    const menuButton = menu();
    fireEvent.click(menuButton);
    const search = screen.getByRole("button", { name: /^Search/ });
    (entry === "button" ? search : screen.getByRole("link", { name: "Notes" })).focus();
    if (entry === "button") fireEvent.click(search);
    else fireEvent.keyDown(window, { key: "k", ctrlKey: entry === "Control shortcut", metaKey: entry === "Command shortcut" });
    const box = screen.getByRole("textbox", { name: "Search everything" });
    expect(document.getElementById("app-navigation")?.hidden).toBe(true);
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Search everything" })).toBeNull();
    expect(document.activeElement).toBe(menu());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("returns focus to Menu after a mouse click on Search that left focus on the page (WebKit)", () => {
    mount();
    const menuButton = menu();
    fireEvent.click(menuButton);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
    const box = screen.getByRole("textbox", { name: "Search everything" });
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(document.activeElement).toBe(menu());
  });

  it("keeps the desktop sidebar and its Search focus return when Quick Find closes", () => {
    mount(1320);
    const search = screen.getByRole("button", { name: /^Search/ });
    search.focus();
    fireEvent.click(search);
    expect(document.getElementById("app-navigation")?.hidden).toBe(false);
    const box = screen.getByRole("textbox", { name: "Search everything" });
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(document.activeElement).toBe(search);
    expect(screen.getAllByRole("link")).toHaveLength(sections.length);
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

it.each(["Menu", "Search", "Notes", "Settings"])("PACKS-06 Escape from %s closes narrow navigation and focuses Menu", name => {
  mount();
  fireEvent.click(menu());
  const target = name === "Menu" ? menu() : name === "Search" ? screen.getByRole("button", { name: /^Search/ }) : screen.getByRole("link", { name });
  target.focus();
  fireEvent.keyDown(target, { key: "Escape" });
  expect(menu().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(menu());
  expect(screen.queryByRole("navigation")).toBeNull();
});

it("PACKS-06 leaves desktop Escape and Escape outside the narrow menu alone", () => {
  mount(1320);
  const notes = screen.getByRole("link", { name: "Notes" });
  notes.focus();
  expect(fireEvent.keyDown(notes, { key: "Escape" })).toBe(true);
  expect(document.activeElement).toBe(notes);
  expect(screen.getByRole("navigation")).toBeTruthy();
  resize(644);
  fireEvent.click(menu());
  expect(fireEvent.keyDown(document.body, { key: "Escape" })).toBe(true);
  expect(menu().getAttribute("aria-expanded")).toBe("true");
});

it("PACKS-06 preserves Escape for a dialog inside the menu and for a child that already handled it", () => {
  mount();
  fireEvent.click(menu());
  const navigation = document.getElementById("app-navigation")!;
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const input = document.createElement("input");
  dialog.append(input);
  navigation.append(dialog);
  input.focus();
  expect(fireEvent.keyDown(input, { key: "Escape" })).toBe(true);
  expect(menu().getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(input);
  dialog.remove();
  const notes = screen.getByRole("link", { name: "Notes" });
  notes.focus();
  notes.addEventListener("keydown", event => event.preventDefault(), { once: true });
  fireEvent.keyDown(notes, { key: "Escape" });
  expect(menu().getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(notes);
});

it("measures the narrow header for anchor clearance and releases the observer on desktop", () => {
  let notify: () => void = () => undefined;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { notify = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  let height = 144;
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ height }) as DOMRect);
  try {
    mount(390);
    const shell = document.querySelector<HTMLElement>(".shell")!;
    expect(shell.style.getPropertyValue("--narrow-header-height")).toBe("144px");
    height = 288;
    act(() => notify());
    expect(shell.style.getPropertyValue("--narrow-header-height")).toBe("288px");
    resize(1100);
    expect(shell.style.getPropertyValue("--narrow-header-height")).toBe("");
    expect(disconnect).toHaveBeenCalledOnce();
  } finally { bounds.mockRestore(); }
});

describe("POLISH-04 new pages open at the top", () => {
  it("scrolls to the top on a push to a new page, but not for a #section link, Back, or the same page", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    try {
      mount(1320);
      act(() => navTo("/study"));
      expect(scrollTo).toHaveBeenCalledWith(0, 0);
      scrollTo.mockClear();
      act(() => navTo("/study?tab=due"));
      expect(scrollTo).not.toHaveBeenCalled();
      act(() => navTo("/study/x#read-pdf-text"));
      expect(scrollTo).not.toHaveBeenCalled();
      act(() => navTo(-1));
      act(() => navTo(-1));
      expect(scrollTo).not.toHaveBeenCalled();
      act(() => navTo("/notes"));
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
