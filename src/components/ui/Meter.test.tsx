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

describe("Meter ticks", () => {
  it("renders aria-hidden ticks only when asked, zero stays zero", () => {
    const { container, rerender } = render(
      <Meter value={0} max={10} startLabel="0 h" endLabel="of 10 h" ariaLabel="Hours" ticks={5} />,
    );
    expect(container.querySelector(".meter__ticks")?.getAttribute("aria-hidden")).toBe("true");
    expect((container.querySelector(".meter__fill") as HTMLElement).style.width).toBe("0%");
    expect(screen.getByText("0 h")).toBeTruthy();
    rerender(<Meter value={3} max={10} startLabel="3 h" endLabel="10 h" ariaLabel="Hours" />);
    expect(container.querySelector(".meter__ticks")).toBeNull();
  });
});
