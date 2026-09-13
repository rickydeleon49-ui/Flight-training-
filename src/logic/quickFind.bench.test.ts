import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { AppData } from "@/state/AppDataContext";
import { makeMaterial } from "@/testing/factories";
import { quickFind } from "./quickFind";

// Run with HFD_BENCH=1 to measure ranking/search over a large training record.
it.skipIf(process.env.HFD_BENCH !== "1")("benchmarks global search", () => {
  const materials = Array.from({ length: 5_000 }, (_, index) =>
    makeMaterial({ id: `material-${index}`, title: `Material ${index} airspace`, notes: "Navigation and airspace review" }),
  );
  const data = {
    materials, events: [], journalEntries: [], goals: [], milestones: [], questions: [], notes: [],
  } as unknown as AppData;
  const samples: number[] = [];
  for (let repeat = 0; repeat < 25; repeat++) {
    const started = performance.now();
    const results = quickFind(data, "airspace", "2026-09-13");
    samples.push(performance.now() - started);
    expect(results.length).toBe(12);
  }
  samples.sort((a, b) => a - b);
  if (process.env.HFD_BENCH_OUT) writeFileSync(process.env.HFD_BENCH_OUT,
    JSON.stringify({ count: materials.length, medianMs: samples[12] }, null, 2));
});
