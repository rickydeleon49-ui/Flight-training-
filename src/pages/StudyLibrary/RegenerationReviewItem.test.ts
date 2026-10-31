// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ItemContent } from "./RegenerationReviewDialog";

afterEach(cleanup);

it("previews a new guide section with the saved guide's renderer, not raw Markdown", () => {
  const { container } = render(h(ItemContent, { kind: "section", fields: ["Lift", "Overview.\n### Four forces\n- Lift acts upward.\n- Drag opposes thrust."] }));
  expect(container.textContent).not.toContain("###");
  expect(container.textContent).not.toMatch(/^- /m);
  expect(container.querySelector(".guide-body")).not.toBeNull();
  expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Lift acts upward.", "Drag opposes thrust."]);
});

it("still shows a card as question and answer text", () => {
  const { container } = render(h(ItemContent, { kind: "card", fields: ["What supports flight?", "Lift."] }));
  expect(container.textContent).toContain("Question: What supports flight?");
  expect(container.textContent).toContain("Answer: Lift.");
});
