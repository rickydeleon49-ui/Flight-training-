// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListRow } from "./ListRow";

afterEach(cleanup);

describe("ListRow", () => {
  it("renders a link with a chevron", () => {
    const { container } = render(<MemoryRouter><ListRow to="/x" title="Open" chevron /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/x");
    expect(container.querySelector(".list-row__chevron")).toBeTruthy();
  });

  it("renders a button that activates on click and Enter", () => {
    const onClick = vi.fn();
    render(<ListRow onClick={onClick} title="Go" />);
    const b = screen.getByRole("button", { name: "Go" });
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(b.tagName).toBe("BUTTON");
  });

  it("renders a plain row with value and no chevron", () => {
    const { container } = render(<ListRow title="Hours" subtitle="Total" value="12" />);
    expect(container.querySelector("div.list-row")).toBeTruthy();
    expect(container.querySelector(".list-row__chevron")).toBeNull();
    expect(screen.getByText("12").className).toContain("list-row__value");
    expect(screen.getByText("Total")).toBeTruthy();
  });
});
