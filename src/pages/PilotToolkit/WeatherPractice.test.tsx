// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { WEATHER_PRACTICE } from "@/logic/weatherPractice";
import { WeatherPractice } from "./WeatherPractice";

afterEach(cleanup);

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
