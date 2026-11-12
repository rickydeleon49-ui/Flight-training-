// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Meter } from "./Feedback";

describe("Meter progressbar a11y", () => {
  it("exposes label, min, max and now", () => {
    render(<Meter value={3} max={10} startLabel="3 h" endLabel="10 h" ariaLabel="Hours logged" />);
    const bar = screen.getByRole("progressbar", { name: "Hours logged" });
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("10");
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
  });
});
