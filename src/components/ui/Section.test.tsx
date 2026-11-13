// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmptyState, Loading } from "./Feedback";
import { Card } from "./Card";
import { Section } from "./Section";

afterEach(cleanup);

describe("Section", () => {
  it("renders a section labelled by its h2 title", () => {
    render(<Section title="Next steps"><p>Body</p></Section>);
    const region = screen.getByRole("region", { name: "Next steps" });
    const h2 = screen.getByRole("heading", { level: 2, name: "Next steps" });
    expect(region.getAttribute("aria-labelledby")).toBe(h2.id);
    expect(region.querySelector(".section__rule")).toBeTruthy();
  });

  it("uses a given heading id and renders actions", () => {
    render(<Section title="Log" headingId="log-h" actions={<button>Add</button>}><p>x</p></Section>);
    expect(screen.getByRole("heading", { name: "Log" }).id).toBe("log-h");
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });
});

describe("card--flat", () => {
  it("adds the flat class and keeps default output unchanged", () => {
    const { container, rerender } = render(<Card variant="flat">x</Card>);
    expect(container.querySelector(".card.card--flat")).toBeTruthy();
    rerender(<Card>x</Card>);
    expect(container.querySelector(".card--flat")).toBeNull();
  });
});

describe("Section wrap and compact opt-in", () => {
  it("keeps a long title with actions in a wrapping header", () => {
    const { container } = render(<Section title={"Very long title ".repeat(10)} actions={<a href="#x">See all</a>}><p>x</p></Section>);
    expect(container.querySelector(".section__header")).toBeTruthy();
    expect(container.querySelector(".section__rule")?.getAttribute("aria-hidden")).toBe("true");
  });
  it("is compact only when asked", () => {
    const { container, rerender } = render(<EmptyState title="t" />);
    expect(container.querySelector(".empty-state--compact")).toBeNull();
    rerender(<EmptyState title="t" compact />);
    expect(container.querySelector(".empty-state--compact")).toBeTruthy();
    rerender(<Loading />);
    expect(container.querySelector(".loading--compact")).toBeNull();
    rerender(<Loading compact />);
    expect(container.querySelector(".loading--compact")).toBeTruthy();
  });
});
