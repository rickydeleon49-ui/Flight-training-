// @vitest-environment jsdom
/**
 * The local date source shared by the Daily Flight Plan hook and card.
 *
 * Runs in America/Los_Angeles so the local day and the UTC day disagree for
 * part of every day: 2026-09-26T06:59Z is still 2026-09-25 locally.
 */
import { createElement as h } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { todayIso } from "@/lib/dates";
import { msUntilNextLocalMidnight, useLocalToday } from "./useLocalToday";

const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

function Show() {
  return h("p", { "data-testid": "today" }, useLocalToday());
}
const shown = () => screen.getByTestId("today").textContent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLocalToday", () => {
  it("uses the local calendar day, not the UTC one", () => {
    // 23:59:30 on the 25th in Los Angeles is already the 26th in UTC.
    vi.setSystemTime(new Date("2026-09-26T06:59:30.000Z"));
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-09-26");
    expect(todayIso()).toBe("2026-09-25");

    render(h(Show));
    expect(shown()).toBe("2026-09-25");
  });

  it("advances at local midnight while mounted, with one timer and no polling", () => {
    vi.setSystemTime(new Date("2026-09-26T06:59:30.000Z")); // 23:59:30 local
    render(h(Show));
    expect(shown()).toBe("2026-09-25");
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(29_000); // 23:59:59 local
    });
    expect(shown()).toBe("2026-09-25");

    act(() => {
      vi.advanceTimersByTime(2_000); // just past local midnight
    });
    expect(shown()).toBe("2026-09-26");
    expect(vi.getTimerCount()).toBe(1); // rescheduled for the next midnight, not a loop
  });

  it("catches up on focus or visibility after sleeping past midnight", () => {
    vi.setSystemTime(new Date("2026-09-26T04:00:00.000Z")); // 21:00 local on the 25th
    render(h(Show));
    expect(shown()).toBe("2026-09-25");

    // The machine sleeps: the clock jumps, but no timer has run.
    vi.setSystemTime(new Date("2026-09-26T15:00:00.000Z")); // 08:00 local on the 26th
    expect(shown()).toBe("2026-09-25");

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(shown()).toBe("2026-09-26");

    vi.setSystemTime(new Date("2026-09-27T15:00:00.000Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(shown()).toBe("2026-09-27");
  });

  it("removes its timer and listeners on unmount", () => {
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    vi.setSystemTime(new Date("2026-09-26T04:00:00.000Z"));
    const view = render(h(Show));
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeWindow).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("schedules for the next local midnight, not the next UTC midnight", () => {
    // 17:00 local (00:00 UTC next day) → 7 hours to local midnight, plus the margin.
    const now = new Date("2026-09-26T00:00:00.000Z");
    expect(msUntilNextLocalMidnight(now)).toBe(7 * 3_600_000 + 1_000);
  });
});
