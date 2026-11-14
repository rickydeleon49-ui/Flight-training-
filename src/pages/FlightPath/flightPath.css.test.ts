import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "flightPath.css"), "utf8");
const tsx = readFileSync(resolve(__dirname, "FlightPath.tsx"), "utf8");

it("route nodes: hollow upcoming, filled done, berry ring current", () => {
  expect(css).toMatch(/\.waypoint__marker\s*\{[^}]*background:\s*var\(--surface-page\)/);
  expect(css).toMatch(/\.waypoint--done \.waypoint__marker\s*\{[^}]*background:\s*var\(--text-secondary\)/);
  expect(css).toMatch(/\.waypoint--current \.waypoint__marker\s*\{[^}]*border-color:\s*var\(--accent-primary\)/);
});

it("berry accent is only for the current stage", () => {
  const withoutCurrent = css.replace(/\.waypoint--current[^{]*\{[^}]*\}/g, "");
  expect(withoutCurrent).not.toMatch(/--accent-primary(?!-fill)/);
  expect(tsx).not.toMatch(/tone="berry">Completed|"berry"\s*:/);
});

it("checklist rows have a readable measure and 44px targets", () => {
  expect(css).toMatch(/\.checklist-row\s*\{[^}]*max-width:\s*68ch[^}]*min-height:\s*var\(--hit-min\)/);
});

it("unassigned goals get no route node", () => {
  const block = tsx.slice(tsx.indexOf("waypoint--unassigned"), tsx.indexOf("Not part of a stage"));
  expect(block).not.toContain("waypoint__marker");
});
