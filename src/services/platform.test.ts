import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(() => true) }));
vi.mock("@/data", () => ({ isTauri: mocks.isTauri }));

import { IPHONE_SEND_ENABLED, deviceCan, isIOS, isMacOS } from "./platform";

function stub(userAgent: string, maxTouchPoints = 0) {
  vi.stubGlobal("navigator", { userAgent, maxTouchPoints });
}

afterEach(() => { vi.unstubAllGlobals(); mocks.isTauri.mockReturnValue(true); });

describe("platform", () => {
  it("the send card is off until the iPhone app is ready", () => {
    expect(IPHONE_SEND_ENABLED).toBe(false);
    stub("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(deviceCan().sendToIphone).toBe(false);
  });

  it("recognises a Mac", () => {
    stub("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    expect(isMacOS()).toBe(true);
    expect(isIOS()).toBe(false);
    expect(deviceCan().importFiles).toBe(true);
    expect(deviceCan().getStudyMaterial).toBe(false);
  });

  it("recognises an iPhone", () => {
    stub("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5);
    expect(isIOS()).toBe(true);
    expect(isMacOS()).toBe(false);
    expect(deviceCan().getStudyMaterial).toBe(true);
    expect(deviceCan().importFiles).toBe(false);
    expect(deviceCan().generate).toBe(false);
  });

  it("recognises an iPad that reports itself as a Mac", () => {
    stub("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5);
    expect(isIOS()).toBe(true);
    expect(isMacOS()).toBe(false);
  });

  it("does not offer phone import in an iOS browser", () => {
    stub("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5);
    mocks.isTauri.mockReturnValue(false);
    expect(deviceCan().getStudyMaterial).toBe(false);
    expect(deviceCan().sendToIphone).toBe(false);
  });

  it("recognises Windows as neither", () => {
    stub("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(isIOS()).toBe(false);
    expect(isMacOS()).toBe(false);
    expect(deviceCan().sendToIphone).toBe(false);
  });
});
