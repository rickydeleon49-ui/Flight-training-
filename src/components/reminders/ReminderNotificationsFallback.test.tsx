// @vitest-environment jsdom
import { StrictMode, type ContextType } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { makeEvent } from "@/testing/factories";
import { todayIso } from "@/lib/dates";
import { ReminderNotifications } from "./ReminderNotifications";

const requestPermission = vi.fn();
const notify = vi.fn();
function view({ enabled = true, ready = true, due = true } = {}) {
  const value = { status: ready ? "ready" : "loading", data: {
    ...EMPTY_DATA, events: due ? [makeEvent({ id: "fictional-lesson", date: todayIso() })] : [],
    toolkit: { ...EMPTY_DATA.toolkit, remindersEnabled: enabled },
  } } as unknown as ContextType<typeof AppDataContext>;
  return <StrictMode><AppDataContext.Provider value={value}><MemoryRouter><ReminderNotifications /></MemoryRouter></AppDataContext.Provider></StrictMode>;
}
beforeEach(() => {
  sessionStorage.clear(); vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32"); requestPermission.mockReset(); notify.mockReset();
  vi.stubGlobal("Notification", class {
    static permission = "denied";
    static requestPermission = requestPermission;
    constructor() { notify(); }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["denied", "default", "unavailable"])("shows a reminder banner with no permission prompt (%s)", permission => {
  if (permission === "unavailable") Reflect.deleteProperty(window, "Notification");
  else Object.defineProperty(Notification, "permission", { value: permission });
  render(view());
  expect(screen.getByRole("status").textContent).toContain("training reminder");
  expect(screen.getByRole("link", { name: "View training reminders" }).getAttribute("href")).toBe("/toolkit");
  expect(requestPermission).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
});
it("keeps a dismissed banner hidden through rerenders and remounts", () => {
  const { rerender, unmount } = render(view());
  fireEvent.click(screen.getByRole("button", { name: "Dismiss reminders" }));
  expect(screen.queryByRole("status")).toBeNull();
  rerender(view()); unmount(); render(view());
  expect(screen.queryByRole("status")).toBeNull();
});
it.each([{ enabled: false }, { ready: false }, { due: false }])("waits for enabled, loaded, due reminders (%j)", options => {
  render(view(options)); expect(screen.queryByRole("status")).toBeNull();
});
it("falls back if a granted OS toast throws", () => {
  Object.defineProperty(Notification, "permission", { value: "granted" });
  notify.mockImplementation(() => { throw Error("Unavailable"); });
  render(view()); expect(screen.getByRole("status")).toBeTruthy();
  expect(requestPermission).not.toHaveBeenCalled();
});

it("keeps the Mac unchanged: no banner on macOS even when notices are denied (Windows prep only)", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  render(view());
  expect(screen.queryByRole("link", { name: "View training reminders" })).toBeNull();
});
