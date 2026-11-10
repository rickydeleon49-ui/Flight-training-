// @vitest-environment jsdom
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Checkbox, Field, TextInput } from "./Form";

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

it("renders the switch appearance as the same checkbox with role switch, a label and toggling", () => {
  let value = false;
  const view = () => h(Checkbox, { checked: value, onChange: (next: boolean) => { value = next; }, label: "Reminders", appearance: "switch" });
  const { rerender } = render(view());
  const control = screen.getByRole("switch", { name: "Reminders" }) as HTMLInputElement;
  expect(control.type).toBe("checkbox");
  expect(control.closest("label")!.className).toContain("checkbox--switch");
  fireEvent.click(control);
  expect(value).toBe(true);
  rerender(view());
  expect((screen.getByRole("switch") as HTMLInputElement).checked).toBe(true);
  cleanup();
  render(h(Checkbox, { checked: false, onChange: () => {}, label: "Plain" }));
  expect(screen.getByRole("checkbox", { name: "Plain" }).hasAttribute("role")).toBe(false);
});

it("keeps every form input at 16px or larger with a 44px target", () => {
  const css = readFileSync(join(__dirname, "ui.css"), "utf8");
  const block = css.match(/\.input,\s*\.textarea,\s*\.select\s*\{[^}]*font-size:[^}]*\}/)![0];
  expect(block).toMatch(/font-size:\s*var\(--text-callout\)/);
  expect(block).toMatch(/min-height:\s*44px/);
});
