import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({ isPermissionGranted: vi.fn(), requestPermission: vi.fn(), sendNotification: vi.fn() }));
const tauri = vi.hoisted(() => ({ on: true }));
vi.mock("@tauri-apps/plugin-notification", () => plugin);
vi.mock("@/data", () => ({ isTauri: () => tauri.on }));

import { askPermission, canNotify, notify } from "./notify";

beforeEach(() => {
  tauri.on = true;
  Object.values(plugin).forEach((fn) => fn.mockReset());
});

describe("notify", () => {
  it("sends when permission is granted", async () => {
    plugin.isPermissionGranted.mockResolvedValue(true);
    expect(await canNotify()).toBe(true);
    expect(await notify("Her Flight Deck", "Hello")).toBe(true);
    expect(plugin.sendNotification).toHaveBeenCalledWith({ title: "Her Flight Deck", body: "Hello" });
    expect(plugin.requestPermission).not.toHaveBeenCalled();
  });

  it("never asks on its own and sends nothing when permission is missing", async () => {
    plugin.isPermissionGranted.mockResolvedValue(false);
    expect(await canNotify()).toBe(false);
    expect(await notify("t", "b")).toBe(false);
    expect(plugin.sendNotification).not.toHaveBeenCalled();
    expect(plugin.requestPermission).not.toHaveBeenCalled();
  });

  it("asks only through askPermission, and reports a denial", async () => {
    plugin.isPermissionGranted.mockResolvedValue(false);
    plugin.requestPermission.mockResolvedValue("denied");
    expect(await askPermission()).toBe(false);
    plugin.requestPermission.mockResolvedValue("granted");
    expect(await askPermission()).toBe(true);
    expect(plugin.requestPermission).toHaveBeenCalledTimes(2);
  });

  it("does not ask again when already granted", async () => {
    plugin.isPermissionGranted.mockResolvedValue(true);
    expect(await askPermission()).toBe(true);
    expect(plugin.requestPermission).not.toHaveBeenCalled();
  });

  it("treats a permission that was revoked later as not allowed", async () => {
    plugin.isPermissionGranted.mockResolvedValueOnce(true).mockResolvedValue(false);
    expect(await canNotify()).toBe(true);
    expect(await notify("t", "b")).toBe(false);
    expect(plugin.sendNotification).not.toHaveBeenCalled();
  });

  it("never throws when the plugin does", async () => {
    plugin.isPermissionGranted.mockRejectedValue(new Error("boom"));
    plugin.requestPermission.mockRejectedValue(new Error("boom"));
    expect(await canNotify()).toBe(false);
    expect(await askPermission()).toBe(false);
    expect(await notify("t", "b")).toBe(false);
    plugin.isPermissionGranted.mockResolvedValue(true);
    plugin.sendNotification.mockImplementation(() => { throw new Error("boom"); });
    expect(await notify("t", "b")).toBe(false);
  });

  it("does nothing outside the app", async () => {
    tauri.on = false;
    expect(await canNotify()).toBe(false);
    expect(await askPermission()).toBe(false);
    expect(await notify("t", "b")).toBe(false);
    expect(plugin.isPermissionGranted).not.toHaveBeenCalled();
  });
});
