// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { IosBackButton } from "./IosBackButton";

let seen = { path: "", length: 0 };
function Where() {
  const { pathname } = useLocation();
  seen = { path: pathname, length: window.history.length };
  return h("p", null, pathname, h(Link, { to: "/study/m-1" }, "open"));
}
function mount(path: string) {
  return render(h(MemoryRouter, { initialEntries: [path] }, h(IosBackButton), h(Where)));
}
afterEach(cleanup);

describe("IosBackButton", () => {
  it("shows the parent's name", () => {
    mount("/study/m-1");
    const button = screen.getByRole("button", { name: "Back to Study" });
    expect(button.textContent).toContain("Study");
  });

  it.each(["/", "/study", "/schedule", "/journal", "/more"])("is absent on %s", (path) => {
    mount(path);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("goes back in history when it came from the parent", () => {
    mount("/study");
    fireEvent.click(screen.getByRole("link", { name: "open" }));
    expect(seen.path).toBe("/study/m-1");
    const before = seen.length;
    fireEvent.click(screen.getByRole("button", { name: "Back to Study" }));
    expect(seen.path).toBe("/study");
    expect(seen.length).toBe(before);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("goes to the parent page on a deep link", () => {
    mount("/settings");
    fireEvent.click(screen.getByRole("button", { name: "Back to More" }));
    expect(seen.path).toBe("/more");
  });
});
