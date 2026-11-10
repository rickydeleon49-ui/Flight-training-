// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";

const mutate = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
let date: unknown;
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data: { toolkit: { ...DEFAULT_TOOLKIT_STATE, checkrideDate: date } }, mutate }),
}));

import { CHECKRIDE_COUNTDOWN_LINE, CheckrideDateCard } from "./CheckrideDateCard";

beforeEach(() => {
  date = undefined;
  save.mockReset();
  mutate.mockReset().mockImplementation(async (work: (repos: unknown) => Promise<unknown>) => work({ toolkit: { save } }));
});
afterEach(cleanup);

const input = () => screen.getByLabelText("Checkride date") as HTMLInputElement;

describe("CheckrideDateCard", () => {
  it("starts empty with the plain line and Clear disabled", () => {
    render(<CheckrideDateCard />);
    expect(input().value).toBe("");
    expect(screen.getByText(CHECKRIDE_COUNTDOWN_LINE)).toBeTruthy();
    expect(CHECKRIDE_COUNTDOWN_LINE).toBe("We'll count down the days on your Flight Deck.");
    expect((screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves a picked date", async () => {
    render(<CheckrideDateCard />);
    fireEvent.change(input(), { target: { value: "12/01/2026" } });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0].checkrideDate).toBe("2026-12-01");
  });

  it("shows the saved date and Clear removes it", async () => {
    date = "2026-12-01";
    render(<CheckrideDateCard />);
    expect(input().value).toBe("12/01/2026");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0].checkrideDate).toBeNull();
  });
});
