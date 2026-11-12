import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./ui.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

it("text inputs, textareas and selects keep a 44px minimum height", () => {
  const rule = css.match(/\.input,\s*\.textarea,\s*\.select\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(rule).toMatch(/min-height:\s*44px/);
});

it("no later rule shrinks the shared form controls below 44px", () => {
  const small = [...css.matchAll(/([^{}]*\.(?:input|select)\b[^{}]*)\{([^}]*)\}/g)]
    .filter(([, , body]) => /min-height:\s*(?:\d|[12]\d|3\d|4[0-3])(?:\.\d+)?px/.test(body!));
  expect(small).toEqual([]);
});
