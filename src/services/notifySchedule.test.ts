import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(), sendNotification: vi.fn(), cancel: vi.fn(),
  Schedule: { interval: vi.fn((i: unknown) => ({ interval: i })) },
}));
vi.mock("@tauri-apps/plugin-notification", () => plugin);
vi.mock("@/data", async (o) => ({ ...(await o<typeof import("@/data")>()), isTauri: () => true }));

import { cancelDaily, scheduleDaily } from "./notify";

beforeEach(() => {
  plugin.isPermissionGranted.mockReset().mockResolvedValue(true);
  plugin.sendNotification.mockReset();
  plugin.cancel.mockReset().mockResolvedValue(undefined);
});

describe("daily schedule", () => {
  it("cancels the old one, then schedules one repeating notice at HH:MM", async () => {
    expect(await scheduleDaily("07:30", "T", "B")).toBe(true);
    expect(plugin.cancel).toHaveBeenCalledBefore(plugin.sendNotification);
    expect(plugin.Schedule.interval).toHaveBeenCalledWith({ hour: 7, minute: 30 });
    expect(plugin.sendNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "T", body: "B", id: expect.any(Number) }));
  });
  it("schedules nothing without permission or with a bad time", async () => {
    plugin.isPermissionGranted.mockResolvedValue(false);
    expect(await scheduleDaily("07:30", "T", "B")).toBe(false);
    plugin.isPermissionGranted.mockResolvedValue(true);
    expect(await scheduleDaily("nope", "T", "B")).toBe(false);
    expect(plugin.sendNotification).not.toHaveBeenCalled();
  });
  it("cancel removes it and never throws", async () => {
    await cancelDaily();
    expect(plugin.cancel).toHaveBeenCalledWith([expect.any(Number)]);
    plugin.cancel.mockRejectedValue(new Error("x"));
    await expect(cancelDaily()).resolves.toBeUndefined();
  });
});
