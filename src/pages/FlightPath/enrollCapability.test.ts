import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("allows exactly the three FAA URLs used by Before you enroll", () => {
  const source = readFileSync("src/pages/FlightPath/BeforeYouEnroll.tsx", "utf8");
  const urls = [...source.matchAll(/url: "(https:\/\/www\.faa\.gov\/[^\"]+)"/g)].map((match) => match[1]);
  expect(urls).toHaveLength(3);
  const capability = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8"));
  const permission = capability.permissions.find((p: { identifier?: string }) => p.identifier === "opener:allow-open-url");
  expect(permission.allow.filter((entry: { url: string }) => entry.url.includes("faa.gov"))).toEqual(urls.map((url) => ({ url })));
});
