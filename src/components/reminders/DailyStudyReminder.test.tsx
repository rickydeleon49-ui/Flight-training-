// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";

const svc = vi.hoisted(() => ({ notify: vi.fn(), scheduleDaily: vi.fn(), cancelDaily: vi.fn() }));
const phone = vi.hoisted(() => ({ on: false }));
vi.mock("@/services/notify", () => svc);
vi.mock("@/services/platform", () => ({ schedulesDailyReminder: () => phone.on }));

import { DailyStudyReminder, STUDY_REMINDER_BODY, studyReminderKey } from "./DailyStudyReminder";

function view(reminder: { enabled: boolean; time: string } | undefined) {
  const data = { ...EMPTY_DATA, toolkit: { ...EMPTY_DATA.toolkit, studyReminder: reminder } };
  return h(AppDataContext.Provider, { value: { data, status: "ready" } as unknown as ContextType<typeof AppDataContext> }, h(DailyStudyReminder));
}
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const run = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  phone.on = false;
  svc.notify.mockReset().mockResolvedValue(true);
  svc.scheduleDaily.mockReset().mockResolvedValue(true);
  svc.cancelDaily.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DailyStudyReminder on the Mac", () => {
  it("fires once at the time with a generic body", async () => {
    at("2026-11-09T18:59:00");
    render(view({ enabled: true, time: "19:00" }));
    await run(30_000);
    expect(svc.notify).not.toHaveBeenCalled();
    await run(60_000);
    expect(svc.notify).toHaveBeenCalledTimes(1);
    expect(svc.notify.mock.calls[0]![1]).toBe(STUDY_REMINDER_BODY);
    expect(STUDY_REMINDER_BODY).toBe("Time for a short study session.");
  });

  it("does not fire twice the same day, even after a remount", async () => {
    at("2026-11-09T18:59:30");
    const first = render(view({ enabled: true, time: "19:00" }));
    await run(60_000);
    await run(5 * 60_000);
    first.unmount();
    at("2026-11-09T19:00:20");
    render(view({ enabled: true, time: "19:00" }));
    await run(120_000);
    expect(svc.notify).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(studyReminderKey("2026-11-09"))).not.toBeNull();
  });

  it("fires again the next day", async () => {
    at("2026-11-09T18:59:30");
    render(view({ enabled: true, time: "19:00" }));
    await run(60_000);
    at("2026-11-10T18:59:30");
    await run(60_000);
    expect(svc.notify).toHaveBeenCalledTimes(2);
  });

  it("skips when the app opens after the time", async () => {
    at("2026-11-09T20:30:00");
    render(view({ enabled: true, time: "19:00" }));
    await run(10 * 60_000);
    expect(svc.notify).not.toHaveBeenCalled();
  });

  it("wake from sleep soon after the time still fires once; much later it does not", async () => {
    at("2026-11-09T18:50:00");
    render(view({ enabled: true, time: "19:00" }));
    // The clock jumps (sleep) without timers running.
    at("2026-11-09T19:03:00");
    act(() => { window.dispatchEvent(new Event("focus")); });
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(svc.notify).toHaveBeenCalledTimes(1);
  });

  it("wake long after the time shows nothing", async () => {
    at("2026-11-09T18:50:00");
    render(view({ enabled: true, time: "19:00" }));
    at("2026-11-09T22:00:00");
    act(() => { window.dispatchEvent(new Event("focus")); });
    await run(120_000);
    expect(svc.notify).not.toHaveBeenCalled();
  });

  it("uses the wall clock across a clock change (DST style jump)", async () => {
    at("2026-03-08T01:59:30");
    render(view({ enabled: true, time: "03:00" }));
    // Clocks spring forward: the wall clock moves an hour in one step.
    at("2026-03-08T03:00:10");
    await run(60_000);
    expect(svc.notify).toHaveBeenCalledTimes(1);
  });

  it("does nothing when off or missing", async () => {
    at("2026-11-09T18:59:30");
    render(view({ enabled: false, time: "19:00" }));
    await run(120_000);
    cleanup();
    render(view(undefined));
    await run(120_000);
    expect(svc.notify).not.toHaveBeenCalled();
    expect(svc.scheduleDaily).not.toHaveBeenCalled();
  });

  it("turning off stops it", async () => {
    at("2026-11-09T18:58:00");
    const r = render(view({ enabled: true, time: "19:00" }));
    r.rerender(view({ enabled: false, time: "19:00" }));
    await run(5 * 60_000);
    expect(svc.notify).not.toHaveBeenCalled();
  });
});

describe("DailyStudyReminder on the iPhone", () => {
  beforeEach(() => { phone.on = true; });

  it("schedules once, replaces on a time change, and does not use the in-app timer", async () => {
    at("2026-11-09T18:59:30");
    const r = render(view({ enabled: true, time: "19:00" }));
    await run(0);
    expect(svc.scheduleDaily).toHaveBeenCalledWith("19:00", expect.any(String), STUDY_REMINDER_BODY);
    r.rerender(view({ enabled: true, time: "07:30" }));
    await run(0);
    expect(svc.scheduleDaily).toHaveBeenLastCalledWith("07:30", expect.any(String), STUDY_REMINDER_BODY);
    await run(120_000);
    expect(svc.notify).not.toHaveBeenCalled();
  });

  it("cancels when turned off", async () => {
    const r = render(view({ enabled: true, time: "19:00" }));
    await run(0);
    r.rerender(view({ enabled: false, time: "19:00" }));
    await run(0);
    expect(svc.cancelDaily).toHaveBeenCalled();
  });
});
