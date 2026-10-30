/**
 * TESTTOOLS-01: an accessibility gate for jsdom render tests, calling
 * axe-core (MPL-2.0, dev dependency only) directly.
 *
 * `color-contrast` is always off: jsdom has no layout or canvas, so axe cannot
 * measure it here. `region` (all content inside landmarks) is off unless
 * `landmarks` is set: screen tests render a page without the AppShell that
 * supplies `<main>` and the navigation, and the AppShell test checks it.
 * Pass `disable` for a known violation with a TODO naming the rule, never to
 * hide a new one.
 */
import axe from "axe-core";
import { expect } from "vitest";

export interface A11yOptions {
  /** Also require every element to sit inside a landmark (for the full app shell). */
  landmarks?: boolean;
  /** axe rule ids to skip for this check (each needs a TODO at the call site). */
  disable?: readonly string[];
}

function describeViolations(violations: axe.Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(" ")}: ${n.failureSummary?.split("\n").join(" ") ?? ""}`)
        .join("\n");
      return `  [${v.impact ?? "?"}] ${v.id}: ${v.help}\n${nodes}`;
    })
    .join("\n");
}

/** Fails the test with a readable list when axe finds any violation in `container`. */
export async function expectNoA11yViolations(container: Element, options: A11yOptions = {}): Promise<void> {
  const rules: axe.RuleObject = { "color-contrast": { enabled: false } };
  if (!options.landmarks) rules.region = { enabled: false };
  for (const id of options.disable ?? []) rules[id] = { enabled: false };
  const results = await axe.run(container, { rules, resultTypes: ["violations"] });
  expect(results.violations, `axe found accessibility violations:\n${describeViolations(results.violations)}`).toEqual([]);
}
