// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { initIOSText } from "./iosText";

const mocks = vi.hoisted(() => ({ isIOS: vi.fn() }));
vi.mock("@/services/platform", () => ({ isIOS: mocks.isIOS }));

let cleanup = () => {};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("marks iOS before render and follows changes to the independent system font", () => {
  mocks.isIOS.mockReturnValue(true);
  let notify = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { notify = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  const computed = vi.fn(() => ({ fontSize: "17px" }));
  vi.stubGlobal("getComputedStyle", computed);
  cleanup = initIOSText();
  const root = document.documentElement;
  expect(root.classList.contains("is-ios")).toBe(true);
  expect(root.style.getPropertyValue("--ios-system-font-size")).toBe("17px");
  expect(computed.mock.calls.length).toBeGreaterThan(0);
  computed.mockReturnValue({ fontSize: "53px" });
  notify();
  expect(root.style.getPropertyValue("--ios-system-font-size")).toBe("53px");
  cleanup();
  expect(disconnect).toHaveBeenCalled();
  expect(document.querySelector(".ios-text-probe")).toBeNull();
  cleanup = () => {};
});

it("leaves desktop typography alone when isIOS is false", () => {
  mocks.isIOS.mockReturnValue(false);
  cleanup = initIOSText();
  expect(document.documentElement.classList.contains("is-ios")).toBe(false);
  expect(document.documentElement.style.getPropertyValue("--ios-system-font-size")).toBe("");
  expect(document.querySelector(".ios-text-probe")).toBeNull();
});
