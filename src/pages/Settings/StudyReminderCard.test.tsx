// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";

const askPermission = vi.hoisted(() => vi.fn());
const mutate = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
const phone = vi.hoisted(() => ({ on: false }));
let reminder: unknown;
vi.mock("@/services/notify", () => ({ askPermission }));
vi.mock("@/services/platform", () => ({ schedulesDailyReminder: () => phone.on }));
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data: { toolkit: { ...DEFAULT_TOOLKIT_STATE, studyReminder: reminder } }, mutate }),
}));

import { REMINDER_DENIED_LINE, REMINDER_MAC_LINE, StudyReminderCard } from "./StudyReminderCard";

beforeEach(() => {
  reminder = undefined;
  phone.on = false;
  askPermission.mockReset();
  save.mockReset();
  mutate.mockReset().mockImplementation(async (work: (repos: unknown) => Promise<unknown>) => work({ toolkit: { save } }));
});
afterEach(cleanup);

const box = () => screen.getByRole("checkbox", { name: "Remind me to study every day" }) as HTMLInputElement;
const time = () => screen.getByLabelText("Reminder time") as HTMLInputElement;

describe("StudyReminderCard", () => {
  it("starts off at 19:00 and shows the Mac limit line", () => {
    render(<StudyReminderCard />);
    expect(box().checked).toBe(false);
    expect(screen.queryByLabelText("Reminder time")).toBeNull();
    expect(screen.getByText(REMINDER_MAC_LINE)).toBeTruthy();
    expect(REMINDER_MAC_LINE).toBe("Your Flight Deck needs to be open (it can be minimized) for the reminder to show.");
  });

  it("shows no limit line on the iPhone", () => {
    phone.on = true;
    render(<StudyReminderCard />);
    expect(screen.queryByText(REMINDER_MAC_LINE)).toBeNull();
  });

  it("asks permission at the tap and saves on when granted", async () => {
    askPermission.mockResolvedValue(true);
    render(<StudyReminderCard />);
    expect(askPermission).not.toHaveBeenCalled();
    fireEvent.click(box());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![0]).toMatchObject({ studyReminder: { enabled: true, time: "19:00" } });
  });

  it("denied leaves the switch off with one line", async () => {
    askPermission.mockResolvedValue(false);
    render(<StudyReminderCard />);
    fireEvent.click(box());
    expect(await screen.findByText(REMINDER_DENIED_LINE)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    expect(box().checked).toBe(false);
  });

  it("turning off does not ask permission", async () => {
    reminder = { enabled: true, time: "08:15" };
    render(<StudyReminderCard />);
    fireEvent.click(box());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(askPermission).not.toHaveBeenCalled();
    expect(save.mock.calls[0]![0]).toMatchObject({ studyReminder: { enabled: false, time: "08:15" } });
  });

  it("shows the time box only while reminders are on", () => {
    reminder = { enabled: true, time: "08:15" };
    render(<StudyReminderCard />);
    expect(time().value).toBe("08:15");
  });

  it("saves a new time, ignoring an empty one", async () => {
    reminder = { enabled: true, time: "19:00" };
    render(<StudyReminderCard />);
    fireEvent.change(time(), { target: { value: "" } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(time(), { target: { value: "06:45" } });
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![0]).toMatchObject({ studyReminder: { enabled: true, time: "06:45" } });
  });
});
