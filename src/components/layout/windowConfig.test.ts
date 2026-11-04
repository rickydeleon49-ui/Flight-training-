import { describe, expect, it } from "vitest";
import config from "../../../src-tauri/tauri.conf.json";

describe("portrait desktop window", () => {
  it("can fit a 644 pt portrait screen while keeping the default desktop size", () => {
    const window = config.app.windows[0]!;
    expect(window.minWidth).toBeGreaterThan(0);
    expect(window.minWidth).toBeLessThanOrEqual(644);
    expect(window.resizable).toBe(true);
    expect([window.width, window.height, window.minHeight]).toEqual([1320, 880, 700]);
  });
});

describe("content security policy", () => {
  it("allows no asset-protocol images; pictures arrive as bytes, not asset URLs", () => {
    const csp = config.app.security.csp;
    const imgSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("img-src"));
    expect(imgSrc).toBe("img-src 'self' data: blob:");
    // blob: is for decoding a picked photo via an object URL; it must stay images-only.
    expect(csp.split(";").filter((part) => part.includes("blob:")).map((part) => part.trim().split(" ")[0]).sort()).toEqual(["frame-src", "img-src"]);
    expect(csp).not.toMatch(/asset/);
  });

  it("lets the page talk only to itself and Tauri IPC; network calls live in Rust", () => {
    const csp = config.app.security.csp;
    const connectSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("connect-src"));
    expect(connectSrc).toBe("connect-src 'self' ipc: http://ipc.localhost");
  });
});
