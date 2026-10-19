// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Field, TextInput } from "./Form";

afterEach(cleanup);

it("associates only rendered help or error text through a complete validation cycle", () => {
  const field = (error?: string) => h(Field, { label: "Title", hint: "Choose a descriptive name", error, children: h(TextInput) });
  const { rerender } = render(field());
  const input = screen.getByRole("textbox", { name: "Title" });
  const descriptions = () => input.getAttribute("aria-describedby")!.split(" ").map((id) => {
    const element = document.getElementById(id);
    expect(element, `description ${id} is rendered`).not.toBeNull();
    return element!.textContent;
  });
  expect(descriptions()).toEqual(["Choose a descriptive name"]);
  rerender(field("Enter a title"));
  expect(descriptions()).toEqual(["Enter a title"]);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  rerender(field());
  expect(descriptions()).toEqual(["Choose a descriptive name"]);
  expect(input.hasAttribute("aria-invalid")).toBe(false);
});
