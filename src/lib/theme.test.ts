// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTheme }) }));
const platform = vi.hoisted(() => ({ ios: false, tauri: false }));
vi.mock("@/services/platform", () => ({ isIOS: () => platform.ios }));
vi.mock("@/data", () => ({ isTauri: () => platform.tauri }));

import { applyTheme, getStoredTheme, initTheme, setStoredTheme, THEME_STORAGE_KEY, type ThemeChoice } from "./theme";

const root = () => document.documentElement;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  platform.ios = false;
  platform.tauri = false;
  setTheme.mockReset();
  localStorage.clear();
  root().removeAttribute("data-theme");
});

describe("theme", () => {
  it("defaults to auto on Mac/browser and sets no attribute", () => {
    expect(getStoredTheme()).toBe("auto");
    initTheme();
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("is auto only on iOS and ignores stored values", () => {
    platform.ios = true;
    expect(getStoredTheme()).toBe("auto");
    for (const v of ["dark", "light"]) {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(v));
      initTheme();
      expect(root().hasAttribute("data-theme")).toBe(false);
      expect(getStoredTheme()).toBe("auto");
    }
  });

  it("round trips all three and removes the attribute for auto", () => {
    for (const t of ["light", "light-grey", "dark", "auto"] as ThemeChoice[]) {
      setStoredTheme(t);
      expect(getStoredTheme()).toBe(t);
      applyTheme(t);
      expect(root().getAttribute("data-theme")).toBe(t === "auto" ? null : t);
    }
  });

  it("handles invalid and plain/quoted values", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(getStoredTheme()).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, '"auto"');
    expect(getStoredTheme()).toBe("auto");
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(getStoredTheme()).toBe("auto");
  });

  it("calls the native window theme on Mac in Tauri, swallowing errors", async () => {
    platform.tauri = true;
    applyTheme("light");
    await vi.waitFor(() => expect(setTheme).toHaveBeenCalledTimes(1));
    applyTheme("dark");
    await vi.waitFor(() => expect(setTheme).toHaveBeenCalledTimes(2));
    applyTheme("light-grey");
    await vi.waitFor(() => expect(setTheme).toHaveBeenCalledTimes(3));
    applyTheme("auto");
    await vi.waitFor(() => expect(setTheme).toHaveBeenCalledTimes(4));
    expect(setTheme.mock.calls.map((c) => c[0])).toEqual(["light", "dark", "light", null]);
    setTheme.mockImplementation(() => {
      throw new Error("no");
    });
    expect(() => applyTheme("dark")).not.toThrow();
    await flush();
  });

  it("does not call the native theme on iOS or outside Tauri", async () => {
    applyTheme("dark");
    platform.tauri = true;
    platform.ios = true;
    applyTheme("dark");
    await flush();
    expect(setTheme).not.toHaveBeenCalled();
  });
});

describe("theme-boot.js", () => {
  const src = readFileSync(resolve(__dirname, "../../public/theme-boot.js"), "utf8");
  const run = (storage: unknown, ua = "Mozilla/5.0 (Macintosh)", touch = 0) => {
    const attrs: Record<string, string> = {};
    const doc = {
      documentElement: {
        setAttribute: (k: string, v: string) => (attrs[k] = v),
        removeAttribute: (k: string) => delete attrs[k],
      },
    };
    new Function("localStorage", "document", "navigator", src)(storage, doc, { userAgent: ua, maxTouchPoints: touch });
    return attrs["data-theme"] ?? null;
  };
  const store = (v: string | null) => ({ getItem: () => v });
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
  };

  it("matches applyTheme(getStoredTheme()) for every stored value", () => {
    for (const v of [null, "light", "light-grey", "dark", "auto", '"dark"', '"auto"', "junk", "{bad"]) {
      localStorage.clear();
      if (v !== null) localStorage.setItem(THEME_STORAGE_KEY, v);
      root().removeAttribute("data-theme");
      applyTheme(getStoredTheme());
      expect(run(store(v))).toBe(root().getAttribute("data-theme"));
    }
  });

  it("never throws and falls back to auto (no attribute)", () => {
    expect(run(throwing)).toBeNull();
    expect(() => new Function("localStorage", "document", "navigator", src)(undefined, undefined, undefined)).not.toThrow();
  });

  it("sets nothing on iPhone and touch Macintosh", () => {
    expect(run(store("dark"), "Mozilla/5.0 (iPhone)")).toBeNull();
    expect(run(store("dark"), "Mozilla/5.0 (Macintosh)", 5)).toBeNull();
  });
});

describe("index.html", () => {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
  it("loads the boot script before main.tsx with no inline script", () => {
    expect(html.indexOf('src="/theme-boot.js"')).toBeGreaterThan(-1);
    expect(html.indexOf("/theme-boot.js")).toBeLessThan(html.indexOf("/src/main.tsx"));
    expect(html.indexOf("/theme-boot.js")).toBeLessThan(html.indexOf("<link"));
    for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) expect((m[1] ?? "").trim()).toBe("");
  });
});
