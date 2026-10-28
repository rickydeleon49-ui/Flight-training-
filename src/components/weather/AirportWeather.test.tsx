// @vitest-environment jsdom
import { type ContextType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { makeEvent, makePrepItem } from "@/testing/factories";
import { EventDetail } from "@/pages/Schedule/EventDetail";
import { airportWeather, WEATHER_PREFERENCE } from "@/services/weather";
import { WEATHER_NOTE, type WeatherReport } from "@/logic/weather";
import { AirportWeather, WeatherPreference } from "./AirportWeather";
const mock = vi.hoisted(() => ({ native: true, invoke: vi.fn() }));
vi.mock("@/data", async original => ({ ...await original<typeof import("@/data")>(), isTauri: () => mock.native }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
const report: WeatherReport = { station: "KZZZ", name: "Imaginary Learning Field", raw: "METAR KZZZ 281200Z 22007KT P6SM RMK SYNTHETIC", reportTime: 1793188800000, validFrom: null, validTo: null, unavailable: false, conditions: { wspd: 7, wdir: 220, visib: "6+" }, periods: [] };
let mono = 1000000;
beforeEach(() => {
  mono += 200000;
  vi.spyOn(performance, "now").mockImplementation(() => mono);
  mock.native = true;
  mock.invoke.mockReset().mockImplementation(async (command: string) => command === "weather_session" ? 1 : { report, fetchedAt: 1793188800000 });
  airportWeather.setEnabled(false); airportWeather.tick(); localStorage.clear();
});
afterEach(async () => { cleanup(); airportWeather.setEnabled(false); await Promise.resolve(); vi.restoreAllMocks(); localStorage.clear(); });
const gets = () => mock.invoke.mock.calls.filter(([command]) => command === "get_airport_weather");
function enable() { fireEvent.click(screen.getByRole("checkbox", { name: "Show airport weather" })); }
function enter() { fireEvent.change(screen.getByLabelText("Airport ICAO code"), { target: { value: "KZZZ" } }); }
describe("optional lesson weather UI", () => {
  it("defaults OFF, shows exact preference text, and opening/enabling/typing send nothing", async () => {
    render(<><WeatherPreference /><AirportWeather /></>);
    expect((screen.getByRole("checkbox", { name: "Show airport weather" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText("Airport ICAO code")).toBeNull();
    expect(screen.getByText("Gets reports from NOAA/NWS for the airport you enter.")).toBeTruthy();
    enable(); enter(); await act(async () => {});
    expect(gets()).toEqual([]); expect(screen.getByText("Enter the airport's four-letter ICAO code to look at its reports.")).toBeTruthy();
    expect(localStorage.getItem(WEATHER_PREFERENCE)).toBe("true");
  });
  it("browser mode is calm, labels controls and performs no native calls", async () => {
    mock.native = false; mock.invoke.mockClear();
    render(<><WeatherPreference /><AirportWeather /></>); enable(); enter();
    expect(screen.getByText("Weather works in the Mac app.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Get observation" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Get forecast" })); await act(async () => {});
    expect(mock.invoke).not.toHaveBeenCalled(); expect(screen.getAllByText(WEATHER_NOTE).length).toBeGreaterThan(0);
  });
  it("one click sends only station/product/session and renders source, raw and separate times", async () => {
    render(<><WeatherPreference /><AirportWeather /></>); enable(); enter();
    fireEvent.click(screen.getByRole("button", { name: "Get observation" }));
    await screen.findByText(report.raw);
    expect(gets()).toEqual([["get_airport_weather", { station: "KZZZ", product: "metar", session: 1 }]]);
    expect(screen.getByText("KZZZ · Imaginary Learning Field")).toBeTruthy();
    expect(screen.getByText("NOAA/NWS Aviation Weather Center")).toBeTruthy();
    expect(screen.getByText(/Observed:.*UTC/)).toBeTruthy(); expect(screen.getByText(/Last successful fetch:.*UTC/)).toBeTruthy(); expect(screen.getAllByText(/Local:/).length).toBeGreaterThan(0);
    expect(screen.getByText("Wind from 220° at 7 knots. Visibility greater than 6 statute miles. Some details are only in the original report.")).toBeTruthy();
    expect(Object.keys(localStorage)).toEqual([WEATHER_PREFERENCE]);
    expect(screen.getByText(report.raw).style.whiteSpace).toBe("pre-wrap");
  });
  it("NIL/CNL shows full raw and unavailable wording with no normal summary", async () => {
    mock.invoke.mockImplementation(async command => command === "weather_session" ? 1 : { report: { ...report, unavailable: true, raw: "TAF AMD KZZZ 281200Z CNL", conditions: { wspd: 0, wdir: 0 } }, fetchedAt: 1793188800000 });
    render(<><WeatherPreference /><AirportWeather /></>); enable(); enter(); fireEvent.click(screen.getByRole("button", { name: "Get forecast" }));
    await screen.findByText("TAF AMD KZZZ 281200Z CNL"); expect(screen.getByText("No forecast returned for this airport.")).toBeTruthy(); expect(screen.queryByText(/Wind calm/)).toBeNull();
  });
  it("429 error preserves the required line and disables both buttons without retry", async () => {
    mock.invoke.mockImplementation(async command => { if (command === "weather_session") return 1; throw { kind: "rate", retryAfterMs: 120000 }; });
    render(<><WeatherPreference /><AirportWeather /></>); enable(); enter(); fireEvent.click(screen.getByRole("button", { name: "Get observation" }));
    await screen.findByText(/The weather service needs a pause. Try again after/);
    expect((screen.getByRole("button", { name: "Get forecast" }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getAllByText(WEATHER_NOTE).length).toBeGreaterThan(0); expect(gets()).toHaveLength(1);
  });
  it("sits in lesson Preparation without changing counts or sending lesson/profile data", async () => {
    const event = makeEvent({ id: "synthetic-lesson", title: "PRIVATE_LESSON_SENTINEL", location: "PRIVATE_LOCATION_SENTINEL", notes: "PRIVATE_NOTE_SENTINEL", eventType: "flight_lesson" });
    const mutate = vi.fn();
    const value = { repositories: null, data: { ...EMPTY_DATA, events: [event], prepItems: [makePrepItem({ eventId: event.id, title: "Weather review", done: false })] }, status: "ready", error: null, mutate, deleteWithUndo: vi.fn() } as unknown as ContextType<typeof AppDataContext>;
    render(<AppDataContext.Provider value={value}><MemoryRouter initialEntries={[`/schedule/${event.id}#airport-weather`]}><WeatherPreference /><Routes><Route path="/schedule/:eventId" element={<EventDetail />} /></Routes></MemoryRouter></AppDataContext.Provider>);
    enable(); enter(); const prep = screen.getByRole("heading", { name: "Preparation" }).closest("section")!;
    expect(within(prep).getByLabelText("Airport ICAO code")).toBeTruthy(); expect(within(prep).getByText("0 of 1 ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Get observation" })); await screen.findByText(report.raw);
    expect(within(prep).getByText("0 of 1 ready")).toBeTruthy(); expect(mutate).not.toHaveBeenCalled();
    expect(JSON.stringify(gets())).not.toContain("PRIVATE_"); expect(JSON.stringify(value!.data)).not.toContain(report.raw);
    fireEvent.click(screen.getByRole("button", { name: "Lesson brief" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(within(screen.getByRole("dialog")).queryByText(report.raw)).toBeNull();
  });
});
