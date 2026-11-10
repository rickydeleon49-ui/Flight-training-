// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";

const svc = vi.hoisted(() => ({ notify: vi.fn(), scheduleCheckride: vi.fn(), cancelCheckride: vi.fn() }));
const phone = vi.hoisted(() => ({ on: false }));
vi.mock("@/services/notify", () => svc);
vi.mock("@/services/platform", () => ({ schedulesDailyReminder: () => phone.on }));

import { CheckrideNotifications, checkrideNoticeKey } from "./CheckrideNotifications";

function view(date: string | null | undefined) {
  const data = { ...EMPTY_DATA, toolkit: { ...EMPTY_DATA.toolkit, checkrideDate: date } };
  return h(AppDataContext.Provider, { value: { data, status: "ready" } as unknown as ContextType<typeof AppDataContext> }, h(CheckrideNotifications));
}
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const run = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  phone.on = false;
  svc.notify.mockReset().mockResolvedValue(true);
  svc.scheduleCheckride.mockReset().mockResolvedValue(true);
  svc.cancelCheckride.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CheckrideNotifications on the Mac", () => {
  it("fires at 30, 7 and 1 days only, once each, with generic wording", async () => {
    for (const [now, count] of [["2026-10-31T10:00:00", 1], ["2026-11-23T10:00:00", 1], ["2026-11-29T10:00:00", 1]] as const) {
      svc.notify.mockClear();
      at(now);
      const r = render(view("2026-11-30"));
      await run(0);
      expect(svc.notify).toHaveBeenCalledTimes(count);
      r.unmount();
      render(view("2026-11-30")); // reopen the same day: not again
      await run(60 * 60_000);
      expect(svc.notify).toHaveBeenCalledTimes(count);
      cleanup();
    }
    expect(localStorage.getItem(checkrideNoticeKey("2026-11-30", 7))).not.toBeNull();
    expect(svc.notify.mock.calls[0]![1]).toBe("Your checkride is tomorrow.");
  });

  it("sends nothing on other days, on the day, after, or when unset", async () => {
    for (const [now, date] of [["2026-11-15T10:00:00", "2026-11-30"], ["2026-11-30T10:00:00", "2026-11-30"], ["2026-12-05T10:00:00", "2026-11-30"], ["2026-11-15T10:00:00", null]] as const) {
      at(now);
      render(view(date));
      await run(2 * 60 * 60_000);
      cleanup();
    }
    expect(svc.notify).not.toHaveBeenCalled();
  });

  it("never schedules on the Mac", async () => {
    at("2026-11-23T10:00:00");
    render(view("2026-11-30"));
    await run(0);
    expect(svc.scheduleCheckride).not.toHaveBeenCalled();
  });
});

describe("CheckrideNotifications on the iPhone", () => {
  beforeEach(() => { phone.on = true; });

  it("schedules only the future milestones, replaces on a date change, cancels on clear", async () => {
    at("2026-11-09T10:00:00");
    const r = render(view("2026-12-30"));
    await run(0);
    const first = svc.scheduleCheckride.mock.calls[0]![0] as { at: Date; body: string }[];
    expect(first.map((n) => n.at.getDate())).toEqual([30, 23, 29]);
    expect(first.every((n) => n.at.getHours() === 9)).toBe(true);
    expect(first[2]!.body).toBe("Your checkride is tomorrow.");

    r.rerender(view("2026-11-12"));
    await run(0);
    const second = svc.scheduleCheckride.mock.calls[1]![0] as { body: string }[];
    expect(second.map((n) => n.body)).toEqual(["Your checkride is tomorrow."]);

    r.rerender(view(null));
    await run(0);
    expect(svc.cancelCheckride).toHaveBeenCalledTimes(1);
    await run(2 * 60 * 60_000);
    expect(svc.notify).not.toHaveBeenCalled();
  });
});
