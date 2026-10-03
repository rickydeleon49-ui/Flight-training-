# A3-R4 nested parent-first diagnostic — 2 October 2026

Run against the local corrected source hashes in the re-review. Main does not contain this implementation. APIs were disabled through the existing capability-removal helper. The test establishes an open descendant under a closed dialog; the existing fallback CSS at `ui.css:321` hides that ancestor and its subtree.

Command: `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx --no-install vitest run src/components/ui/codexA3Nested.diagnostic.test.ts`.

Observed: exit 1; 1 failed; 396 ms. Failed assertion: expected no `dialog:not([open])` ancestor for the still-open inner modal; received the closed outer dialog. Codex removed the temporary test and retained its source/log under ignored `.smoke/mac-a3-compat/`.

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
function nested(outer: boolean, inner: boolean) {
  return h("div", null, h("main", null, h("button", null, "Page")), h(Dialog, {
    open: outer, title: "Outer", onClose() {}, children: h(Dialog, {
      open: inner, title: "Inner", onClose() {}, children: h("button", null, "Inner action"),
    }),
  }));
}
const box = (name: string) => screen.getByText(name, { selector: "h2" }).closest("dialog")!;
it("keeps an open nested modal outside closed ancestors when its parent closes first", () => {
  const ui = render(nested(true, false));
  ui.rerender(nested(true, true));
  expect(box("Inner").contains(document.activeElement)).toBe(true);
  ui.rerender(nested(false, true));
  expect(box("Inner").hasAttribute("open")).toBe(true);
  expect(box("Inner").parentElement!.closest("dialog:not([open])")).toBeNull();
});
```
