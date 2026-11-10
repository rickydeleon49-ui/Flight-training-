// @vitest-environment jsdom
/** Appearance setting (Classic vs Glass) in Settings and application startup. */
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { getStoredTheme, THEME_STORAGE_KEY } from "@/lib/theme";
import { Settings } from "@/pages/Settings/Settings";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";
import { expectNoA11yViolations } from "@/testing/a11y";
import { useStatusAfterEffects, waitForReadyAfterEffects } from "@/testing/afterEffects";

const isIOSMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/services/platform", async (orig) => ({
  ...(await orig<typeof import("@/services/platform")>()),
  isIOS: isIOSMock,
}));

let db: TestDatabase;
vi.mock("@/data", () => ({
  getDatabase: () => Promise.resolve(db),
  isTauri: () => false,
}));

let context: ReturnType<typeof useAppData>;
function Probe() {
  context = useAppData();
  useStatusAfterEffects(context.status);
  return null;
}
function Ready() {
  return useAppData().status === "ready"
    ? h(Routes, null, h(Route, { path: "/settings", element: h(Settings) }))
    : null;
}
async function open() {
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ["/settings"] }, h(Probe), h(Ready))));
  await waitForReadyAfterEffects();
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

  describe("Theme control", () => {
    afterEach(() => {
      document.documentElement.removeAttribute("data-theme");
    });

    it("Mac: Light is selected by default", async () => {
      await open();
      const group = await screen.findByRole("radiogroup", { name: "Theme" });
      expect(group).toBeTruthy();
      expect((screen.getByRole("radio", { name: "Light" }) as HTMLInputElement).checked).toBe(true);
      expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    });

    it("choosing Dark sets data-theme and saves; Auto removes it and saves auto", async () => {
      await open();
      const dark = (await screen.findByRole("radio", { name: "Dark" })) as HTMLInputElement;
      await act(async () => {
        fireEvent.click(dark);
      });
      expect(dark.checked).toBe(true);
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(getStoredTheme()).toBe("dark");

      await act(async () => {
        fireEvent.click(screen.getByRole("radio", { name: "Auto" }));
      });
      expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(JSON.stringify("auto"));
      expect(screen.getByText("Matches your iPhone or Mac")).toBeTruthy();
    });

    it("radios share a name so arrow keys move the choice", async () => {
      await open();
      const radios = (await screen.findAllByRole("radio")).filter(
        (r) => (r as HTMLInputElement).name === "theme",
      ) as HTMLInputElement[];
      expect(radios.map((r) => r.value)).toEqual(["light", "dark", "auto"]);
    });

    it("iPhone: no radiogroup, plain Auto row", async () => {
      isIOSMock.mockReturnValue(true);
      try {
        await open();
        await screen.findByText("Appearance");
        expect(screen.queryByRole("radiogroup", { name: "Theme" })).toBeNull();
        expect(screen.getByText("Auto · Matches your iPhone")).toBeTruthy();
      } finally {
        isIOSMock.mockReturnValue(false);
      }
    });
  });
});
