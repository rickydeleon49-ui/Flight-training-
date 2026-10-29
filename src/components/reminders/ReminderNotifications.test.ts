// @vitest-environment jsdom
import { createElement as h, StrictMode, type ContextType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppDataContext, EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import { makeEvent } from "@/testing/factories";
import { todayIso } from "@/lib/dates";
import { ReminderNotifications } from "./ReminderNotifications";

let data: AppData;
let status: "loading" | "ready";
const requestPermission = vi.fn();
const notify = vi.fn();
const sessionKey = () => `her-flight-deck-reminders-${todayIso()}`;
const lesson = () => makeEvent({ id: "fictional-lesson", date: todayIso() });
function view() {
  return h(StrictMode, null, h(AppDataContext.Provider,
    { value: { data, status } as unknown as ContextType<typeof AppDataContext> },
    h(MemoryRouter, null, h(ReminderNotifications))));
}
function permission(value: NotificationPermission) {
  vi.stubGlobal("Notification", class {
    static permission = value;
    static requestPermission = requestPermission;
    constructor(...args: unknown[]) { notify(...args); }
  });
}
function noPopup() {
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "View training reminders" })).toBeNull();
  expect(requestPermission).not.toHaveBeenCalled();
}

beforeEach(() => {
  sessionStorage.clear();
  status = "ready";
  data = { ...EMPTY_DATA, toolkit: { ...EMPTY_DATA.toolkit, remindersEnabled: true } };
  requestPermission.mockReset().mockResolvedValue("granted");
  notify.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(["default", "denied", "granted"] as const)("never opens a launch dialog or requests permission (%s)", value => {
  permission(value);
  data.events = [lesson()];
  render(view());
  noPopup();
  expect(notify).toHaveBeenCalledTimes(value === "granted" ? 1 : 0);
});

it.each(["default", "granted"] as const)("never opens a dialog when an event is created mid-session (%s)", value => {
  permission(value);
  const { rerender } = render(view());
  expect(notify).not.toHaveBeenCalled();
  data = { ...data, events: [lesson()] };
  rerender(view());
  noPopup();
  expect(notify).toHaveBeenCalledTimes(value === "granted" ? 1 : 0);
});

it("does not send system notifications when reminders are off", () => {
  permission("granted");
  data = { ...data, events: [lesson()], toolkit: { ...data.toolkit, remindersEnabled: false } };
  render(view());
  noPopup();
  expect(notify).not.toHaveBeenCalled();
});

it("waits for loaded data before sending a permitted system notification", () => {
  permission("granted");
  status = "loading";
  data.events = [lesson()];
  const { rerender } = render(view());
  expect(notify).not.toHaveBeenCalled();
  status = "ready";
  rerender(view());
  noPopup();
  expect(notify).toHaveBeenCalledOnce();
});

it("sends at most one permitted notification per day, including rerenders and remounts", () => {
  permission("granted");
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = new Date();
  data.events = [lesson()];
  const { rerender, unmount } = render(view());
  expect(notify).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem(sessionKey())).toBe("seen");
  data = { ...data, events: [...data.events] };
  rerender(view());
  unmount();
  const next = render(view());
  expect(notify).toHaveBeenCalledOnce();
  vi.setSystemTime(new Date(start.getTime() + 86_400_000));
  data = { ...data, events: [lesson()] };
  next.rerender(view());
  expect(notify).toHaveBeenCalledTimes(2);
  expect(sessionStorage.getItem(sessionKey())).toBe("seen");
  noPopup();
});

it("honors the existing daily sessionStorage key", () => {
  permission("granted");
  sessionStorage.setItem(sessionKey(), "seen");
  data.events = [lesson()];
  render(view());
  noPopup();
  expect(notify).not.toHaveBeenCalled();
});

it("does not open a fallback dialog if a system notification fails", () => {
  permission("granted");
  notify.mockImplementationOnce(() => { throw new Error("Notifications unavailable"); });
  data.events = [lesson()];
  render(view());
  noPopup();
});
