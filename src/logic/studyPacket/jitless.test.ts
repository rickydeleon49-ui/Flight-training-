/**
 * The app's CSP is `script-src 'self'` without 'unsafe-eval'. Zod 4 probes
 * `new Function` unless `jitless` is set, and a strict CSP reports that probe
 * as a violation even though Zod catches it. This file counts Function
 * constructor use while the real validator runs. Vitest isolates each test
 * file, so the counter and module loading below do not affect other files.
 */
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";

const RealFunction = globalThis.Function;
let calls = 0;
globalThis.Function = new Proxy(RealFunction, {
  construct(target, args) {
    calls++;
    return Reflect.construct(target, args);
  },
  apply(target, self, args) {
    calls++;
    return Reflect.apply(target, self, args);
  },
});
afterAll(() => {
  globalThis.Function = RealFunction;
});

describe("Zod jitless under the app CSP", () => {
  it("validates every fixture without constructing a Function", async () => {
    vi.resetModules();
    const { validatePacketBytes } = await import("./index");
    const dir = new URL("../../testing/fixtures/study-packets/", import.meta.url);
    let validated = 0;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "expected-outcomes.json")) {
      validatePacketBytes(new Uint8Array(readFileSync(new URL(name, dir))));
      validated++;
    }
    expect(validated).toBe(56);
    expect(calls).toBe(0);
  });

  it("would construct Functions if jitless were off (positive control for the counter)", async () => {
    const z = await import("zod");
    expect(z.config().jitless).toBe(true);
    const before = calls;
    z.config({ jitless: false });
    try {
      z.strictObject({ a: z.string(), b: z.number() }).parse({ a: "x", b: 1 });
    } finally {
      z.config({ jitless: true });
    }
    expect(calls).toBeGreaterThan(before);
  });
});
