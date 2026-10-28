// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeatherController, WEATHER_PREFERENCE, storedWeatherPreference, type WeatherReply } from "./weather";
import type { WeatherReport } from "@/logic/weather";
const report: WeatherReport = { station: "KZZZ", name: "Invented Learning Field", raw: "KZZZ 281200Z NIL", unavailable: false, reportTime: 1793188800000, validFrom: null, validTo: null, conditions: {}, periods: [] };
function harness(enabled = true, native = true) {
  let wall = 1793188800000, mono = 0;
  const get = vi.fn(async (): Promise<WeatherReply> => ({ report, fetchedAt: wall }));
  const session = vi.fn(async () => 1);
  const controller = new WeatherController({ native: () => native, get, session, wall: () => wall, mono: () => mono }, enabled);
  return { controller, get, session, advance(ms: number) { wall += ms; mono += ms; controller.tick(); }, jump(ms: number) { wall += ms; controller.tick(); } };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
describe("manual airport weather memory controller", () => {
  it("sends no request when OFF, including a direct action", async () => {
    const h = harness(false); h.controller.open(); h.controller.setStation("KZZZ"); await h.controller.request("metar"); expect(h.get).not.toHaveBeenCalled();
  });
  it("makes no request on open, typing, enabling, ticks, close or reconnect", async () => {
    const h = harness(false); const close = h.controller.open(); h.controller.setEnabled(true); h.controller.setStation("KZZZ"); h.advance(120000);
    window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus"));
    await Promise.resolve(); expect(h.get).not.toHaveBeenCalled(); close(); await h.controller.request("taf"); expect(h.get).not.toHaveBeenCalled();
  });
  it("browser mode never invokes native sessions or requests", async () => {
    const h = harness(true, false); h.controller.open(); h.controller.setStation("KZZZ"); await h.controller.request("metar"); expect(h.get).not.toHaveBeenCalled(); expect(h.session).not.toHaveBeenCalled();
  });
  it("validates before invocation and sends only code, product and opaque session", async () => {
    const h = harness(); h.controller.open(); h.controller.setStation("ZZZ"); await h.controller.request("metar"); expect(h.get).not.toHaveBeenCalled();
    h.controller.setStation(" kZzz "); await h.controller.request("metar"); expect(h.get.mock.calls).toEqual([["KZZZ", "metar", 1]]);
  });
  it("allows one action and one flight, preserves independent products and enforces local cooldown", async () => {
    const h = harness(); h.controller.open(); h.controller.setStation("KZZZ");
    const pending = deferred<WeatherReply>(); h.get.mockReturnValueOnce(pending.promise);
    const first = h.controller.request("metar"); await h.controller.request("taf"); await Promise.resolve();
    pending.resolve({ report, fetchedAt: 1793188800000 }); await first; expect(h.get).toHaveBeenCalledTimes(1);
    await h.controller.request("metar"); expect(h.get).toHaveBeenCalledTimes(1);
    h.advance(2000); await h.controller.request("taf"); expect(h.get).toHaveBeenCalledTimes(2);
    expect(h.controller.snapshot().metar.report).toEqual(report); expect(h.controller.snapshot().taf.report).toEqual(report);
    h.advance(58000); await h.controller.request("metar"); expect(h.get).toHaveBeenCalledTimes(3);
  });
  it.each(["offline", "timeout", "server", "unreadable", "mismatch", "oversize"])("retains earlier report and fetch age on %s", async kind => {
    const h = harness(); h.controller.open(); h.controller.setStation("KZZZ"); await h.controller.request("metar"); const before = h.controller.snapshot().metar;
    h.advance(60000); h.get.mockRejectedValueOnce({ kind }); await h.controller.request("metar");
    const after = h.controller.snapshot().metar; expect(after.report).toBe(before.report); expect(after.fetchedAt).toBe(before.fetchedAt); expect(after.previous).toBe(true);
    expect(after.status).toBe(kind === "offline" ? "Weather couldn't be reached. You may be offline." : "Weather couldn't be updated. Try again later.");
  });
  it("empty response removes earlier product without affecting the other", async () => {
    const h = harness(); h.controller.open(); h.controller.setStation("KZZZ"); await h.controller.request("metar"); h.advance(2000); await h.controller.request("taf"); h.advance(60000);
    h.get.mockResolvedValueOnce({ report: null, fetchedAt: 1793188862000 }); await h.controller.request("metar");
    expect(h.controller.snapshot().metar.report).toBeNull(); expect(h.controller.snapshot().metar.status).toBe("No observation returned for this airport"); expect(h.controller.snapshot().taf.report).toBe(report);
  });
  it("NIL/CNL is unavailable and never reuses an earlier conditions summary", async () => {
    const h = harness(); h.controller.open(); h.controller.setStation("KZZZ"); h.get.mockResolvedValueOnce({ report: { ...report, unavailable: true }, fetchedAt: 1793188800000 }); await h.controller.request("taf");
    expect(h.controller.snapshot().taf.status).toBe("No forecast returned for this airport."); expect(h.controller.snapshot().taf.report?.unavailable).toBe(true);
  });
  it("429 pauses all products, honors native delay, and never retries automatically", async () => {
    const h = harness(); h.controller.open(); h.controller.setStation("KZZZ"); h.get.mockRejectedValueOnce({ kind: "rate", retryAfterMs: 120000 }); await h.controller.request("metar");
    h.advance(60000); await h.controller.request("taf"); expect(h.get).toHaveBeenCalledTimes(1); h.advance(60001); expect(h.get).toHaveBeenCalledTimes(1);
    await h.controller.request("taf"); expect(h.get).toHaveBeenCalledTimes(2);
  });
  it.each(["off", "station", "close", "restore"])("invalidates a late response after %s and closes native context", async reason => {
    const h = harness(); const close = h.controller.open(); h.controller.setStation("KZZZ"); const pending = deferred<WeatherReply>(); h.get.mockReturnValueOnce(pending.promise);
    const request = h.controller.request("metar"); await vi.waitFor(() => expect(h.get).toHaveBeenCalledTimes(1));
    if (reason === "off") h.controller.setEnabled(false); else if (reason === "station") h.controller.setStation("KZZB"); else if (reason === "close") close(); else h.controller.clear();
    pending.resolve({ report, fetchedAt: 1793188800000 }); await request; expect(h.controller.snapshot().metar.report).toBeNull();
    if (reason === "off" || reason === "close") await vi.waitFor(() => expect(h.session).toHaveBeenLastCalledWith(false));
  });
  it("rejects an out-of-order station mismatch at the IPC boundary", async () => {
    const h = harness(); h.controller.open(); h.controller.setStation("KZZZ"); h.get.mockResolvedValueOnce({ report: { ...report, station: "KZZB" }, fetchedAt: 1 }); await h.controller.request("metar"); expect(h.controller.snapshot().metar.report).toBeNull();
  });
  it("stores only the boolean device preference; OFF, restart and restore clear weather", async () => {
    expect(storedWeatherPreference()).toBe(false); localStorage.setItem(WEATHER_PREFERENCE,"invalid"); expect(storedWeatherPreference()).toBe(false);
    const h = harness(); h.controller.open(); h.controller.setEnabled(true); h.controller.setStation("KZZZ"); await h.controller.request("metar");
    expect(Object.keys(localStorage)).toEqual([WEATHER_PREFERENCE]); expect(localStorage.getItem(WEATHER_PREFERENCE)).toBe("true"); expect(JSON.stringify(localStorage)).not.toContain("KZZZ");
    expect(harness(storedWeatherPreference()).controller.snapshot().metar.report).toBeNull();
    h.controller.clear(); expect(h.controller.snapshot().station).toBe(""); expect(h.controller.snapshot().metar.report).toBeNull();
    h.controller.setEnabled(false); expect(storedWeatherPreference()).toBe(false); expect(h.controller.snapshot().station).toBe("");
  });
  it("wall-clock jump invalidates old ages and a later fetch cannot bless the other product", async () => {
    const h = harness(); h.controller.open(); h.controller.setStation("KZZZ"); await h.controller.request("metar");
    h.jump(-3600000); expect(h.controller.snapshot().metar.timeConfident).toBe(false);
    h.advance(60000); await h.controller.request("taf"); expect(h.controller.snapshot().metar.timeConfident).toBe(false); expect(h.controller.snapshot().taf.timeConfident).toBe(true);
  });
});
