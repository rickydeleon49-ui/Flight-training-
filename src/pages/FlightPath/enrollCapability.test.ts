import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("allows the FAA URLs and saved video links through the approved web-only scope", () => {
  const source = readFileSync("src/pages/FlightPath/BeforeYouEnroll.tsx", "utf8");
  const urls = [...source.matchAll(/url: "(https:\/\/www\.faa\.gov\/[^\"]+)"/g)].map((match) => match[1]);
  expect(urls.length).toBeGreaterThanOrEqual(3);
  const capability = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8"));
  const permission = capability.permissions.find((p: { identifier?: string }) => p.identifier === "opener:allow-open-url");
  expect(permission.allow).toEqual([{ url: "https://*" }]);
  expect(urls.every((url) => new URL(url!).protocol === "https:")).toBe(true);
});
