// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { writeFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

import type { AppData } from "@/state/AppDataContext";
import { makeAction, makeMaterial } from "@/testing/factories";

let benchData: AppData;
vi.mock("@/state/AppDataContext", () => ({
  useAppData: () => ({ data: benchData, mutate: async () => null }),
}));

import { StudyLibrary } from "./StudyLibrary";

// Run manually: $env:HFD_BENCH='1'; npm exec vitest run src/pages/StudyLibrary/StudyLibrary.bench.test.ts
// Timings include filtering, sorting, related-action lookup, and server-side
// React rendering. They do not measure native WebView paint or database I/O.
it.skipIf(process.env.HFD_BENCH !== "1")("benchmarks large Study Library renders", () => {
  const rows: Array<{ count: number; medianMs: number; htmlChars: number }> = [];
  for (const count of [100, 2_500, 5_000]) {
    localStorage.clear();
    const materials = Array.from({ length: count }, (_, index) =>
      makeMaterial({ id: `material-${index}`, title: `Material ${index}`, notes: "Airspace review" }),
    );
    const actions = materials.map((material, index) =>
      makeAction({ id: `action-${index}`, relatedType: "material", relatedId: material.id }),
    );
    benchData = { materials, actions, goals: [], events: [] } as unknown as AppData;

    const samples: number[] = [];
    let html = "";
    for (let repeat = 0; repeat < 5; repeat++) {
      const started = performance.now();
      html = renderToStaticMarkup(h(MemoryRouter, null, h(StudyLibrary)));
      samples.push(performance.now() - started);
    }
    expect(html).toContain("Material 0");
    expect(html).toContain(`of ${count.toLocaleString()} materials`);
    samples.sort((a, b) => a - b);
    rows.push({ count, medianMs: samples[2]!, htmlChars: html.length });
  }
  if (process.env.HFD_BENCH_OUT) writeFileSync(process.env.HFD_BENCH_OUT, JSON.stringify(rows, null, 2));
});
