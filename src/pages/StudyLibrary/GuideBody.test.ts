// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GuideBody } from "./GuideBody";

afterEach(cleanup);

describe("a formatted guide body", () => {
  it("shows lists, emphasis, quotes and tables as real elements", () => {
    const body = [
      "Before **every** flight, check *fuel*:",
      "- Quantity",
      "- Contamination",
      "",
      "> Aviate, navigate, communicate.",
      "",
      "| Speed | Meaning |",
      "| --- | --- |",
      "| Vx | Best angle |",
    ].join("\n");
    const { container } = render(h(GuideBody, { text: body }));

    expect(container.querySelector("strong")?.textContent).toBe("every");
    expect(container.querySelector("em")?.textContent).toBe("fuel");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Quantity", "Contamination"]);
    expect(container.querySelector("blockquote")?.textContent).toBe("Aviate, navigate, communicate.");

    const table = within(screen.getByRole("region", { name: "Table" })).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Speed", "Meaning"]);
    expect(within(table).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Vx", "Best angle"]);
  });

  it("shows a plain guide's words unchanged", () => {
    const body = "Lift opposes weight.\nThrust opposes drag.";
    const { container } = render(h(GuideBody, { text: body, className: "small" }));
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe(body);
    expect(container.firstElementChild?.className).toBe("guide-body small");
  });

  it("never creates a link, image or HTML from guide text", () => {
    const body = [
      "See [the PHAK](https://www.faa.gov/phak).",
      "![diagram](https://example.com/x.png)",
      '<img src="x" onerror="alert(1)"><script>alert(1)</script><a href="https://example.com">x</a>',
    ].join("\n");
    const { container } = render(h(GuideBody, { text: body }));

    expect(container.querySelector("a, img, script, iframe")).toBeNull();
    expect(container.textContent).toContain("the PHAK (https://www.faa.gov/phak)");
    expect(container.textContent).toContain("diagram");
    expect(container.textContent).toContain('<img src="x" onerror="alert(1)">');
  });

  it("keeps a numbered list's starting number", () => {
    const { container } = render(h(GuideBody, { text: "3. Mixture\n4. Carb heat" }));
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("3");
  });
});
