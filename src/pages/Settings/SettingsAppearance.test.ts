// @vitest-environment jsdom
/** Appearance setting (Classic vs Glass) in Settings and application startup. */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  getStoredAppearance,
  initAppearance,
  setStoredAppearance,
} from "@/lib/appearance";
import { Settings } from "@/pages/Settings/Settings";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { expectNoA11yViolations } from "@/testing/a11y";

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  return null;
}
function Ready() {
  return useAppData().status === "ready"
    ? h(Routes, null, h(Route, { path: "/settings", element: h(Settings) }))
    : null;
}
async function open() {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/settings"] }, h(Probe), h(Ready))));
  await waitFor(() => expect(context.status).toBe("ready"));
}

describe("Appearance setting in Settings", () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-appearance");
    db = await createNodeSqliteDatabase();
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
  });

  afterEach(() => {
    cleanup();
    db.close();
    document.documentElement.removeAttribute("data-appearance");
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("default is Classic with no data-appearance attribute on documentElement", async () => {
    await open();

    expect(document.documentElement.hasAttribute("data-appearance")).toBe(false);
    expect(document.documentElement.getAttribute("data-appearance")).toBeNull();

    const classic = (await screen.findByRole("radio", { name: /^Classic/ })) as HTMLInputElement;
    const glass = screen.getByRole("radio", { name: /^Glass/ }) as HTMLInputElement;

    expect(classic.checked).toBe(true);
    expect(glass.checked).toBe(false);
    expect(
      screen.getByText("Glass gives cards a soft frosted look. Classic is the standard look."),
    ).toBeTruthy();
  await expectNoA11yViolations(document.body);
  });

  it("choosing Glass sets the data-appearance attribute and saves it", async () => {
    await open();

    const classic = (await screen.findByRole("radio", { name: /^Classic/ })) as HTMLInputElement;
    const glass = screen.getByRole("radio", { name: /^Glass/ }) as HTMLInputElement;

    expect(document.documentElement.hasAttribute("data-appearance")).toBe(false);

    await act(async () => {
      fireEvent.click(glass);
    });

    expect(glass.checked).toBe(true);
    expect(classic.checked).toBe(false);
    expect(document.documentElement.getAttribute("data-appearance")).toBe("glass");
    expect(getStoredAppearance()).toBe("glass");
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe(JSON.stringify("glass"));
  });

  it("choosing Classic removes the data-appearance attribute and saves Classic", async () => {
    await open();

    const classic = (await screen.findByRole("radio", { name: /^Classic/ })) as HTMLInputElement;
    const glass = screen.getByRole("radio", { name: /^Glass/ }) as HTMLInputElement;

    await act(async () => {
      fireEvent.click(glass);
    });
    expect(document.documentElement.getAttribute("data-appearance")).toBe("glass");

    await act(async () => {
      fireEvent.click(classic);
    });

    expect(classic.checked).toBe(true);
    expect(glass.checked).toBe(false);
    expect(document.documentElement.hasAttribute("data-appearance")).toBe(false);
    expect(document.documentElement.getAttribute("data-appearance")).toBeNull();
    expect(getStoredAppearance()).toBe("classic");
  });

  it("saved Glass is applied at start before render", async () => {
    setStoredAppearance("glass");
    expect(document.documentElement.hasAttribute("data-appearance")).toBe(false);

    // Calling initAppearance (as done in src/main.tsx before render) applies the attribute immediately
    const applied = initAppearance();
    expect(applied).toBe("glass");
    expect(document.documentElement.getAttribute("data-appearance")).toBe("glass");

    await open();

    const classic = (await screen.findByRole("radio", { name: /^Classic/ })) as HTMLInputElement;
    const glass = screen.getByRole("radio", { name: /^Glass/ }) as HTMLInputElement;

    expect(glass.checked).toBe(true);
    expect(classic.checked).toBe(false);
    expect(document.documentElement.getAttribute("data-appearance")).toBe("glass");
  });

  it("handles unquoted raw strings and invalid values safely", () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, "glass");
    expect(getStoredAppearance()).toBe("glass");
    initAppearance();
    expect(document.documentElement.getAttribute("data-appearance")).toBe("glass");

    localStorage.setItem(APPEARANCE_STORAGE_KEY, "unknown-theme");
    expect(getStoredAppearance()).toBe("classic");
    initAppearance();
    expect(document.documentElement.hasAttribute("data-appearance")).toBe(false);
  });

  it("applyAppearance directly sets and removes data-appearance on documentElement", () => {
    applyAppearance("glass");
    expect(document.documentElement.getAttribute("data-appearance")).toBe("glass");
    applyAppearance("classic");
    expect(document.documentElement.hasAttribute("data-appearance")).toBe(false);
  });
});
