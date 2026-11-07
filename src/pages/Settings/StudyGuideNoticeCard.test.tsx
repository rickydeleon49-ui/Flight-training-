// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";

const askPermission = vi.hoisted(() => vi.fn());
const mutate = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
let notice: boolean | undefined;
vi.mock("@/services/notify", () => ({ askPermission }));
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data: { toolkit: { ...DEFAULT_TOOLKIT_STATE, studyGuideNotice: notice } }, mutate }),
}));

import { NOTICE_DENIED_LINE, StudyGuideNoticeCard } from "./StudyGuideNoticeCard";

beforeEach(() => {
  notice = undefined;
  askPermission.mockReset();
  save.mockReset();
  mutate.mockReset().mockImplementation(async (work: (repos: unknown) => Promise<unknown>) => work({ toolkit: { save } }));
});
afterEach(cleanup);

const box = () => screen.getByRole("checkbox", { name: "Tell me when a study guide is ready" }) as HTMLInputElement;

describe("StudyGuideNoticeCard", () => {
  it("starts off", () => {
    render(<StudyGuideNoticeCard />);
    expect(box().checked).toBe(false);
  });

  it("denied permission leaves the switch off and shows the one line", async () => {
    askPermission.mockResolvedValue(false);
    render(<StudyGuideNoticeCard />);
    fireEvent.click(box());
    expect(await screen.findByText(NOTICE_DENIED_LINE)).toBeTruthy();
    expect(NOTICE_DENIED_LINE).toBe("Turn on notifications for Her Flight Deck in System Settings › Notifications.");
    expect(save).not.toHaveBeenCalled();
    expect(box().checked).toBe(false);
  });

  it("granted permission saves the switch on", async () => {
    askPermission.mockResolvedValue(true);
    render(<StudyGuideNoticeCard />);
    fireEvent.click(box());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![0]).toMatchObject({ studyGuideNotice: true });
    expect(screen.queryByText(NOTICE_DENIED_LINE)).toBeNull();
  });

  it("turning it off does not ask permission", async () => {
    notice = true;
    render(<StudyGuideNoticeCard />);
    fireEvent.click(box());
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(askPermission).not.toHaveBeenCalled();
    expect(save.mock.calls[0]![0]).toMatchObject({ studyGuideNotice: false });
  });
});

describe("capabilities", () => {
  it.each(["default", "mobile"])("%s.json lists notification:default", (name) => {
    const json = JSON.parse(readFileSync(`src-tauri/capabilities/${name}.json`, "utf8")) as { permissions: unknown[] };
    expect(json.permissions).toContain("notification:default");
  });
});
