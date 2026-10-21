// @vitest-environment jsdom
/**
 * Layout and interaction regression tests for AppShell navigation:
 * 1. mobile_nav_active_tab_scrolled_into_view: scrolls the active tab into view
 *    on initial render and on route change, and renders a soft fade at the right
 *    edge when more tabs are off-screen at phone width (390 px).
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { AppShell } from "./AppShell";

let appData: AppData = EMPTY_DATA;

vi.mock("@/components/gemini/GeminiOrphanNotices", () => ({
  GeminiOrphanNotices: () => null,
}));

vi.mock("@/state/AppDataContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAppData: () => ({
    data: appData,
    dataRevision: 1,
    repositories: null,
    pendingDelete: null,
    undoDelete: vi.fn(),
    refresh: vi.fn(),
    mutate: vi.fn().mockResolvedValue({ ok: true }),
  }),
}));

if (typeof window !== "undefined") {
  (window as unknown as { Notification: unknown }).Notification = class {
    static permission = "granted";
    static requestPermission = vi.fn().mockResolvedValue("granted");
  };
}

let navTo: ((path: string) => void) | null = null;

function NavProbe() {
  const navigate = useNavigate();
  navTo = navigate;
  return null;
}

beforeEach(() => {
  appData = EMPTY_DATA;
});

afterEach(() => {
  cleanup();
  navTo = null;
  vi.restoreAllMocks();
});

describe("AppShell navigation", () => {
  it("mobile_nav_active_tab_scrolled_into_view", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      h(
        MemoryRouter,
        { initialEntries: ["/"] },
        h(NavProbe),
        h(Routes, null, h(Route, { path: "*", element: h(AppShell) })),
      ),
    );

    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = screen.getAllByRole("link");
    const deckLink = links.find((l) => l.textContent?.includes("Flight Deck"));
    expect(deckLink).toBeTruthy();
    expect(deckLink?.classList.contains("is-active")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });

    // Mock phone-width horizontal scroll geometry (390 px viewport, tabs overflowing)
    Object.defineProperty(nav, "scrollWidth", { configurable: true, value: 800 });
    Object.defineProperty(nav, "clientWidth", { configurable: true, value: 390 });
    Object.defineProperty(nav, "scrollLeft", { configurable: true, writable: true, value: 0 });

    // Trigger scroll check to verify the right-edge fade appears when more tabs are off-screen
    act(() => {
      fireEvent.scroll(nav);
    });

    const wrapper = nav.closest(".nav-wrapper")!;
    expect(wrapper.querySelector(".nav__fade-right")).not.toBeNull();

    // Scroll all the way to the right: the fade disappears
    act(() => {
      nav.scrollLeft = 410;
      fireEvent.scroll(nav);
    });
    expect(wrapper.querySelector(".nav__fade-right")).toBeNull();

    // Navigate to another tab (e.g. Study Library)
    scrollIntoView.mockClear();
    act(() => {
      navTo?.("/study");
    });

    const studyLink = links.find((l) => l.textContent?.includes("Study Library"));
    expect(studyLink).toBeTruthy();
    expect(studyLink?.classList.contains("is-active")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });
});
