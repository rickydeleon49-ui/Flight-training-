// @vitest-environment jsdom
/**
 * Quick Find over the real provider and SQLite, both with the native modal
 * <dialog> and with showModal/close removed (WebKit before macOS 12.3).
 */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { removeCapabilities } from "@/testing/capabilities";

import { supportsNativeModal } from "../ui/useModalDialog";
import { QUICK_FIND_EVENT, QuickFind } from "./QuickFind";

let db: TestDatabase | null = null;
vi.mock("@/data", () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));

let restore: (() => void) | null = null;
let context: ReturnType<typeof useAppData> | null = null;
let nav: ReturnType<typeof useNavigate> | null = null;

function Probe() {
  context = useAppData();
  nav = useNavigate();
  const location = useLocation();
  return h("output", { "aria-label": "Location" }, location.pathname);
}

async function mount() {
  db = await createNodeSqliteDatabase();
  const repos = createRepositories(db);
  await repos.app.set("airline_starter_pack", "skipped-for-test");
  await repos.documents.create({ id: "m-airspace", title: "Airspace classes handout" });
  await repos.documents.create({ id: "m-airport", title: "Airport signs worksheet" });
  render(h(AppDataProvider, null,
    h(MemoryRouter, { initialEntries: ["/"] },
      h("main", null, h("button", { type: "button" }, "Sidebar search")),
      h(Probe),
      h(QuickFind),
      h(Routes, null, h(Route, { path: "*", element: null })))));
  await waitFor(() => expect(context?.status).toBe("ready"));
}

afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
  db?.close();
  db = null;
  context = null;
  nav = null;
});

const input = () => screen.getByRole("textbox", { name: "Search everything" }) as HTMLInputElement;
const location = () => screen.getByLabelText("Location", { selector: "output" }).textContent;

function openWithShortcut() {
  const opener = screen.getByRole("button", { name: "Sidebar search" });
  opener.focus();
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  return opener;
}

describe("Quick Find without native modal support", () => {
  it("opens with Ctrl+K, focuses the search, navigates results and opens the chosen one", async () => {
    restore = removeCapabilities([[HTMLDialogElement.prototype, "showModal"], [HTMLDialogElement.prototype, "close"]]);
    expect(supportsNativeModal()).toBe(false);
    await mount();
    openWithShortcut();
    const dialog = screen.getByRole("dialog", { name: "Quick find" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(input());
    // The fallback dialog is at <body> level, so the page region around <main> is excluded.
    expect(document.querySelector("main")!.closest("[aria-hidden='true'][inert]")).not.toBeNull();

    fireEvent.change(input(), { target: { value: "air" } });
    const results = screen.getAllByRole("button").filter((b) => b.classList.contains("quick-find__result"));
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]!.classList.contains("is-highlighted")).toBe(true);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    const highlighted = document.querySelector(".quick-find__result.is-highlighted")!;
    expect(highlighted).toBe(results[1]);
    const label = highlighted.querySelector(".quick-find__label")!.textContent;
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(screen.queryByRole("dialog", { name: "Quick find" })).toBeNull();
    const routes: Record<string, string> = {
      "Airspace classes handout": "/study/m-airspace",
      "Airport signs worksheet": "/study/m-airport",
    };
    expect(Object.keys(routes)).toContain(label);
    expect(location()).toBe(routes[label!]);
    expect(document.querySelector("main")!.closest("[aria-hidden='true'], [inert]")).toBeNull();
  });

  it("closes on Escape and on the backdrop, returning focus each time", async () => {
    restore = removeCapabilities([[HTMLDialogElement.prototype, "showModal"], [HTMLDialogElement.prototype, "close"]]);
    await mount();
    const opener = openWithShortcut();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Quick find" })).toBeNull();
    expect(document.activeElement).toBe(opener);

    openWithShortcut();
    fireEvent.click(document.querySelector(".modal-fallback-backdrop")!);
    expect(screen.queryByRole("dialog", { name: "Quick find" })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Tab inside and reopens cleanly from the sidebar event", async () => {
    restore = removeCapabilities([[HTMLDialogElement.prototype, "showModal"], [HTMLDialogElement.prototype, "close"]]);
    await mount();
    act(() => {
      window.dispatchEvent(new Event(QUICK_FIND_EVENT));
    });
    const dialog = screen.getByRole("dialog", { name: "Quick find" });
    fireEvent.change(input(), { target: { value: "airspace" } });
    const last = Array.from(dialog.querySelectorAll<HTMLElement>("input, button")).at(-1)!;
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(input());
    fireEvent.keyDown(input(), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    openWithShortcut();
    expect(input().value).toBe("");
    expect(document.activeElement).toBe(input());
  });

  it("search_palette_closes_on_route_change", async () => {
    restore = removeCapabilities([[HTMLDialogElement.prototype, "showModal"], [HTMLDialogElement.prototype, "close"]]);
    await mount();
    const opener = openWithShortcut();
    expect(screen.getByRole("dialog", { name: "Quick find" })).toBeTruthy();

    act(() => {
      nav?.("/questions");
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Quick find" })).toBeNull();
    });

    // Reopen on the new route and close manually to verify focus restoration still works.
    openWithShortcut();
    expect(screen.getByRole("dialog", { name: "Quick find" })).toBeTruthy();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Quick find" })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("Quick Find with native modal support", () => {
  it("still uses showModal and focuses the search", async () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    const previous = { showModal: proto.showModal, close: proto.close };
    proto.showModal = showModal;
    proto.close = close;
    restore = () => {
      for (const key of ["showModal", "close"] as const) {
        if (previous[key] === undefined) delete proto[key];
        else proto[key] = previous[key];
      }
    };
    expect(supportsNativeModal()).toBe(true);
    await mount();
    openWithShortcut();
    expect(showModal).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input());
    const dialog = document.querySelector("dialog")!;
    expect(dialog.hasAttribute("role")).toBe(false);
    expect(document.querySelector(".modal-fallback-backdrop")).toBeNull();
    // Native Escape closes the dialog itself and fires "close".
    act(() => close.call(dialog));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Quick find" })).toBeNull());
  });
});
