# A3 independent modal-stack regressions — 2 October 2026

Diagnostic source run temporarily against Claude's matching local implementation (base `8b61d87` plus the hashes in the review). Main does not yet contain that implementation. The APIs were disabled, not replaced with successful modal mocks. Codex removed the temporary source afterward and retained the ignored original under `.smoke/mac-a3-compat/`.

Command: `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx --no-install vitest run src/components/ui/codexA3.diagnostic.test.ts`.

Observed: exit 1; 3 failed; 420 ms. Sanitized failure observations:

```text
hides the previous sibling modal when a third modal opens:
  B aria-hidden: expected "true", received null

gives a new top modal a higher layer after a lower modal closed:
  C z-index: expected greater than B 1004, received 1004

returns focus to the surviving opener when the lower modal closes first:
  expected button#opener, received button#inside-A in closed dialog A
```

These are DOM, stack and focus simulations, not observed old-WebKit pixel rendering or VoiceOver. Integrate their behavioral requirements into the maintained suite during correction.

```ts
// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { removeCapabilities } from "@/testing/capabilities";
import { Dialog } from "./Dialog";

let restore: () => void;
beforeEach(() => { restore = removeCapabilities([[HTMLDialogElement.prototype, "showModal"], [HTMLDialogElement.prototype, "close"]]); });
afterEach(() => { cleanup(); restore(); document.body.innerHTML = ""; });
function page(open: string[], order = ["A", "B", "C"]) {
  return h("div", null, h("main", null, h("button", { id: "opener" }, "Open")),
    ...order.map(name => h(Dialog, { key: name, open: open.includes(name), title: name, onClose() {}, children: h("button", { id: `inside-${name}` }, `Inside ${name}`) })));
}
const box = (name: string) => screen.getByText(name, { selector: "h2" }).closest("dialog")!;

it("hides the previous sibling modal when a third modal opens", () => {
  const ui = render(page(["A"]));
  ui.rerender(page(["A", "B"]));
  ui.rerender(page(["A", "B", "C"]));
  expect(box("C").contains(document.activeElement)).toBe(true);
  expect(box("A").getAttribute("aria-hidden")).toBe("true");
  expect(box("B").getAttribute("aria-hidden")).toBe("true");
});

it("gives a new top modal a higher layer after a lower modal closed", () => {
  const ui = render(page(["A", "B"], ["A", "C", "B"]));
  ui.rerender(page(["B"], ["A", "C", "B"]));
  ui.rerender(page(["B", "C"], ["A", "C", "B"]));
  expect(box("C").contains(document.activeElement)).toBe(true);
  expect(Number(box("C").style.zIndex)).toBeGreaterThan(Number(box("B").style.zIndex));
});

it("returns focus to the surviving opener when the lower modal closes first", () => {
  const ui = render(page([]));
  const opener = document.getElementById("opener")!;
  opener.focus();
  ui.rerender(page(["A"]));
  document.getElementById("inside-A")!.focus();
  ui.rerender(page(["A", "B"]));
  ui.rerender(page(["B"]));
  ui.rerender(page([]));
  expect(document.querySelector("dialog[open]")).toBeNull();
  expect(opener.hasAttribute("aria-hidden")).toBe(false);
  expect(document.activeElement).toBe(opener);
});
```
