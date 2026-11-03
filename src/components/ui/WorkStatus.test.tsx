// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkStatus, useElapsed } from "./WorkStatus";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useElapsed", () => {
  it("ticks each second while active and resets when inactive", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ on }) => useElapsed(on), { initialProps: { on: true } });
    expect(result.current).toBe(0);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current).toBe(3);
    rerender({ on: false });
    expect(result.current).toBe(0);
  });
});

describe("WorkStatus", () => {
  it("shows seconds only after 5 s", () => {
    const { rerender } = render(<WorkStatus phase="Saving…" elapsed={4} />);
    expect(screen.getByRole("status").textContent).toBe("Saving…");
    rerender(<WorkStatus phase="Saving…" elapsed={5} />);
    expect(screen.getByRole("status").textContent).toBe("Saving… · 5 s");
  });
});
