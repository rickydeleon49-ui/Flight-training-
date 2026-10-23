// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IconButton } from "./Button";

afterEach(cleanup);

it("keeps the danger icon styling and accessible name when adding action spacing", () => {
  const onClick = vi.fn();
  render(h(IconButton, { label: "Delete synthetic note", tone: "danger", className: "destructive-action", onClick, children: h("svg", { "aria-hidden": true }) }));
  const button = screen.getByRole("button", { name: "Delete synthetic note" });
  for (const name of ["icon-button", "icon-button--danger", "destructive-action"]) {
    expect(button.classList.contains(name)).toBe(true);
  }
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
});
