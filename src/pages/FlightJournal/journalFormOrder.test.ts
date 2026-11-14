import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const src = readFileSync("src/pages/FlightJournal/JournalForm.tsx", "utf8");
const at = (label: string) => src.indexOf(`<Field label="${label}"`, src.indexOf("Tail number / identifier"));

it("R15: flight times sit together right after the aircraft fields, Total first", () => {
  const order = ["Total flight time", "Dual received", "Solo flight time", "Pilot in command (PIC)"].map(at);
  expect(order.every((n) => n > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(src.indexOf("Flight times (hours)")).toBeLessThan(order[0]!);
  expect(order[0]!).toBeLessThan(src.indexOf("More details (airports"));
  expect(src.indexOf("More details (airports")).toBeLessThan(at("Departure airport"));
});

it("R15: Menu ring is suppressed only for pointer focus", () => {
  const css = readFileSync("src/components/layout/shell.css", "utf8");
  expect(css).toMatch(/\.sidebar__menu\[data-pointer\]:focus-visible\s*{\s*outline:\s*none/);
});
