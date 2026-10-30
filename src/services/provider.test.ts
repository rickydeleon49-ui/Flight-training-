import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(), invoke: vi.fn() }));
vi.mock("@/data", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { DesktopOnlyError } from "./documents";
import { providerStatus, selectProvider, type ProviderStatus } from "./provider";

beforeEach(() => {
  mocks.isTauri.mockReturnValue(true);
  mocks.invoke.mockReset();
});

describe("provider services", () => {
  it("reads native status without requesting keys", async () => {
    const status: ProviderStatus = {
      selected: "gemini",
      providers: [{ id: "gemini", connected: true }, { id: "claude", connected: false }],
    };
    mocks.invoke.mockResolvedValue(status);
    expect(await providerStatus()).toEqual(status);
    expect(mocks.invoke.mock.calls).toEqual([["provider_status"]]);
  });

  it("selects Gemini with only its ID", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    await selectProvider("gemini");
    expect(mocks.invoke.mock.calls).toEqual([["select_provider", { id: "gemini" }]]);
  });

  it("preserves the native Claude refusal", async () => {
    mocks.invoke.mockRejectedValue("Claude isn't available yet.");
    await expect(selectProvider("claude")).rejects.toBe("Claude isn't available yet.");
    expect(mocks.invoke).toHaveBeenCalledWith("select_provider", { id: "claude" });
  });

  it("propagates status failures", async () => {
    mocks.invoke.mockRejectedValue("Could not read the saved Gemini key.");
    await expect(providerStatus()).rejects.toBe("Could not read the saved Gemini key.");
  });

  it("refuses browser mode without native calls or local persistence", async () => {
    mocks.isTauri.mockReturnValue(false);
    await expect(providerStatus()).rejects.toBeInstanceOf(DesktopOnlyError);
    await expect(selectProvider("gemini")).rejects.toBeInstanceOf(DesktopOnlyError);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
