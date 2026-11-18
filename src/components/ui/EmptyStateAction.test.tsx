import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EmptyState } from "./Feedback";

it("EmptyState renders its action as a button inside the empty state", () => {
  const html = renderToStaticMarkup(<EmptyState title="T" action={<button type="button">Go</button>} />);
  expect(html).toContain("empty-state");
  expect(html).toMatch(/<button[^>]*>Go<\/button>/);
});
