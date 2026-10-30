// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Schedule } from "@/pages/Schedule/Schedule";
import { Finances } from "@/pages/Finances/Finances";
import { AppDataContext, EMPTY_DATA } from "./AppDataContext";
import { makeEvent, makeTransaction } from "@/testing/factories";

afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each([{ name: "Schedule", Page: Schedule }, { name: "Finances", Page: Finances }])("updates $name past midnight without a data refresh", ({ Page }) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 30, 23, 59, 30));
  const data = { ...EMPTY_DATA, transactions: [makeTransaction()], events: [makeEvent({ title: "Yesterday synthetic lesson", date: "2026-10-30", estimatedCost: 27500 })] };
  const value = { data, visibleData: data, mutate: vi.fn(), deleteWithUndo: vi.fn() } as unknown as ContextType<typeof AppDataContext>;
  render(h(AppDataContext.Provider, { value }, h(MemoryRouter, null, h(Page))));
  // Both screens initially include today's upcoming lesson.
  expect(screen.getAllByText("Yesterday synthetic lesson").length).toBeGreaterThan(0);
  act(() => vi.advanceTimersByTime(31_000));
  if (Page === Schedule) {
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.getByText("Already flown")).toBeTruthy();
    expect(screen.getByText("0 scheduled")).toBeTruthy();
  } else {
    expect(screen.queryByText("Yesterday synthetic lesson")).toBeNull();
  }
});
