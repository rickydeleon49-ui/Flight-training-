// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEATHER_PRACTICE } from "@/logic/weatherPractice";
import { airportWeather } from "@/services/weather";
import type { WeatherReport } from "@/logic/weather";
import { WeatherPractice } from "./WeatherPractice";

const mock = vi.hoisted(() => ({ native: true, invoke: vi.fn() }));
vi.mock("@/data", async (original) => ({ ...(await original<typeof import("@/data")>()), isTauri: () => mock.native }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));

let mono = 5_000_000;
beforeEach(() => {
  mono += 200_000;
  vi.spyOn(performance, "now").mockImplementation(() => mono);
  mock.native = true;
  mock.invoke.mockReset();
  airportWeather.setEnabled(false);
  localStorage.clear();
});
afterEach(async () => {
  cleanup();
  airportWeather.setEnabled(false);
  await Promise.resolve();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("renders the first scenario with answers hidden, then reveals them", () => {
  render(<WeatherPractice />);
  const first = WEATHER_PRACTICE[0]!;
  expect(screen.getByText(first.raw)).toBeTruthy();
  expect(screen.queryByLabelText("Practice answers")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByLabelText("Practice answers")).toBeTruthy();
  expect(screen.getAllByText(first.questions[0]!.answer, { exact: false }).length).toBeGreaterThan(0);
});

it("Next scenario cycles and hides answers again", () => {
  render(<WeatherPractice />);
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  fireEvent.click(screen.getByRole("button", { name: "Next scenario" }));
  expect(screen.getByText(WEATHER_PRACTICE[1]!.raw)).toBeTruthy();
  expect(screen.queryByLabelText("Practice answers")).toBeNull();
  for (let i = 1; i < WEATHER_PRACTICE.length; i++) fireEvent.click(screen.getByRole("button", { name: "Next scenario" }));
  expect(screen.getByText(WEATHER_PRACTICE[0]!.raw)).toBeTruthy();
});

it("with minimums shows the comparison and summary", () => {
  render(<WeatherPractice minimums={{ ceilingFt: 3000, visibilitySm: 5, windKt: 15 }} />);
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText("Visibility 10 SM: inside")).toBeTruthy();
  expect(screen.getByText("Inside the minimums you saved. You and your instructor still make the call.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next scenario" }));
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText("Ceiling 2,500 ft: outside your minimum")).toBeTruthy();
  expect(screen.getByText("Outside your minimum — talk with your instructor.")).toBeTruthy();
});

it("without minimums shows the save hint and no comparison", () => {
  render(<WeatherPractice />);
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  expect(screen.getByText(/No personal minimums saved yet/)).toBeTruthy();
  expect(screen.queryByLabelText("Compared with your minimums")).toBeNull();
});

it("never uses verdict words in any scenario", () => {
  const { container } = render(<WeatherPractice minimums={{ ceilingFt: 3000, visibilitySm: 5, windKt: 15 }} />);
  for (let i = 0; i < WEATHER_PRACTICE.length; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(container.textContent ?? "").not.toMatch(/\b(go|no-go|safe|legal)\b/i);
    expect(container.textContent ?? "").not.toMatch(/ok to fly/i);
    fireEvent.click(screen.getByRole("button", { name: "Next scenario" }));
  }
});

it("puts each revealed answer inside its own question row", () => {
  render(<WeatherPractice />);
  const first = WEATHER_PRACTICE[0]!.questions[0]!;
  fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
  const row = screen.getByText(first.question, { exact: false }).closest("li")!;
  expect(row.textContent).toContain(first.answer);
});

describe("real airport report (optional)", () => {
  const now = Date.now();
  const make = (over: Partial<WeatherReport> = {}): WeatherReport => ({
    station: "KZZZ", name: "Imaginary Learning Field", raw: "KZZZ 181200Z 22007KT 6SM BKN020 SYNTHETIC",
    reportTime: now - 12 * 60_000, validFrom: null, validTo: null, unavailable: false,
    conditions: { wspd: 7, wdir: 220, visib: 6, clouds: [{ cover: "BKN", base: 2000 }] }, periods: [], ...over,
  });
  const reply = (report: WeatherReport | Error) =>
    mock.invoke.mockImplementation(async (command: string) => {
      if (command === "weather_session") return 1;
      if (report instanceof Error) throw { kind: "offline" };
      return { report, fetchedAt: now };
    });
  const turnOn = () => act(async () => airportWeather.setEnabled(true));
  const getReport = async (code = "KZZZ") => {
    fireEvent.change(screen.getByLabelText("Try a real airport (optional)"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Get report" }));
    await act(async () => {});
  };
  const mins = { ceilingFt: 3000, visibilitySm: 5, windKt: 15 };

  it("setting off: explains and keeps made-up practice", () => {
    render(<WeatherPractice />);
    expect(screen.getByText("Real weather needs the weather setting in Settings. Made-up reports still work.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Get report" })).toBeNull();
    expect(screen.getByText(WEATHER_PRACTICE[0]!.raw)).toBeTruthy();
    expect(screen.getByText("Practice only, not for flight")).toBeTruthy();
  });

  it("success: raw report, age, then comparison after Show answer", async () => {
    reply(make());
    render(<WeatherPractice minimums={mins} />);
    await turnOn();
    await getReport("kzzz");
    expect(screen.getByText("Real report, KZZZ")).toBeTruthy();
    expect(screen.getByText(/Observed \d\d:\d\dZ, 12 minutes ago/)).toBeTruthy();
    expect(screen.getByText(make().raw)).toBeTruthy();
    expect(screen.queryByText(WEATHER_PRACTICE[0]!.raw)).toBeNull();
    expect(screen.queryByLabelText("Compared with your personal minimums")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByText("Ceiling 2,000 ft: outside your minimum")).toBeTruthy();
    expect(screen.getByText("Visibility 6 SM: inside")).toBeTruthy();
    expect(screen.getByText("Wind 7 kt: inside")).toBeTruthy();
    expect(screen.getByText("Outside your minimum — talk with your instructor.")).toBeTruthy();
    expect(screen.getByText("This is practice reading a report. Your instructor decides about real flights.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next made-up report" }));
    expect(screen.getByText(WEATHER_PRACTICE[1]!.raw)).toBeTruthy();
    expect(screen.queryByText("Real report, KZZZ")).toBeNull();
  });

  it("unreadable ceiling: says it can't tell", async () => {
    reply(make({ conditions: { wspd: 7, visib: 6, clouds: [{ cover: "BKN" }] } }));
    render(<WeatherPractice minimums={mins} />);
    await turnOn();
    await getReport();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByText(/Can't tell the ceiling from this report/)).toBeTruthy();
    expect(screen.queryByText(/^Ceiling .*: inside/)).toBeNull();
  });

  it("stale: asks for a fresh report", async () => {
    reply(make({ reportTime: now - 120 * 60_000 }));
    render(<WeatherPractice />);
    await turnOn();
    await getReport();
    expect(screen.getByText("This report is over 90 minutes old. Get a fresh one.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Get report" })).toBeTruthy();
  });

  it("failure: friendly line and made-up practice still works", async () => {
    reply(new Error("offline"));
    render(<WeatherPractice />);
    await turnOn();
    await getReport();
    expect(screen.getByText(/Weather couldn't be reached.*Made-up practice still works\./)).toBeTruthy();
    expect(screen.getByText(WEATHER_PRACTICE[0]!.raw)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByLabelText("Practice answers")).toBeTruthy();
  });

  it("rate limit: a complete sentence, never a dangling 'after'", async () => {
    mock.invoke.mockImplementation(async (command: string) => {
      if (command === "weather_session") return 1;
      throw { kind: "rate" };
    });
    render(<WeatherPractice />);
    await turnOn();
    await getReport();
    expect(screen.getByText("The weather service needs a pause. Try again in a minute. Made-up practice still works.")).toBeTruthy();
  });

  it("clear sky: ceiling none reported, inside", async () => {
    reply(make({ raw: "KZZZ 181200Z 22007KT 10SM CLR SYNTHETIC", conditions: { wspd: 7, visib: 10, clouds: [{ cover: "CLR" }] } }));
    render(<WeatherPractice minimums={mins} />);
    await turnOn();
    await getReport();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByText("Ceiling none reported: inside")).toBeTruthy();
  });

  it("never uses verdict words in the live flow", async () => {
    reply(make());
    const { container } = render(<WeatherPractice minimums={mins} />);
    await turnOn();
    await getReport();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(container.textContent ?? "").not.toMatch(/\b(go|no-go|safe|legal)\b/i);
    expect(container.textContent ?? "").not.toMatch(/ok to fly/i);
  });
});
