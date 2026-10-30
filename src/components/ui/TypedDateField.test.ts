// @vitest-environment jsdom
/**
 * DATES-01: one typed date field everywhere. It reads a typed date back in
 * words as soon as it can, refuses one that isn't a date plainly, and never
 * changes what she typed. jsdom only.
 */
import { createElement as h, createRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NOT_A_DATE, TypedDateField, typedDateProblem, type TypedDateFieldHandle } from "./TypedDateField";

afterEach(cleanup);

function show(props: { value?: string; required?: boolean; min?: string; max?: string; hint?: string } = {}) {
  const onChange = vi.fn();
  const ref = createRef<TypedDateFieldHandle>();
  function Harness() {
    const [value, setValue] = useState(props.value ?? "");
    return h(TypedDateField, {
      ...props,
      ref,
      label: "Date",
      value,
      onChange: (date: string) => {
        onChange(date);
        setValue(date);
      },
    });
  }
  render(h(Harness));
  const input = screen.getByLabelText("Date") as HTMLInputElement;
  return { input, onChange, ref };
}

describe("TypedDateField", () => {
  it.each(["11052026", "11/05/2026", "11-5-2026", "2026-11-05"])("accepts %s as November 5, 2026", (typed) => {
    const { input, onChange } = show();
    expect(input.type).toBe("text");
    expect(input.placeholder).toBe("e.g. 11/05/2026");
    fireEvent.change(input, { target: { value: typed } });
    expect(onChange).toHaveBeenLastCalledWith("2026-11-05");
    expect(input.value).toBe(typed);
  });

  it("reads the date back while she is still in the box, before she leaves it", () => {
    const { input } = show();
    input.focus();
    fireEvent.change(input, { target: { value: "1105202" } });
    expect(screen.queryByText(/^That's /)).toBeNull();
    fireEvent.change(input, { target: { value: "11052026" } });
    const readBack = screen.getByText("That's Thursday, November 5, 2026.");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-describedby")).toBe(readBack.id);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("never changes a typed date when she leaves the box", () => {
    const { input } = show();
    fireEvent.change(input, { target: { value: "11052026" } });
    fireEvent.blur(input);
    expect(input.value).toBe("11052026");
    expect(screen.getByText("That's Thursday, November 5, 2026.")).toBeTruthy();
  });

  it("refuses a day that doesn't exist plainly on leaving the box, not while typing", () => {
    const { input, onChange, ref } = show({ value: "2026-11-05" });
    fireEvent.change(input, { target: { value: "13/29/2026" } });
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(screen.queryByText(NOT_A_DATE)).toBeNull();
    fireEvent.blur(input);
    const error = screen.getByText(NOT_A_DATE);
    expect(error.textContent).toBe("That isn't a date — try 11/05/2026.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    expect(input.value).toBe("13/29/2026");
    expect(screen.queryByText(/^That's /)).toBeNull();
    expect(ref.current!.check()).toBe(false);
    fireEvent.change(input, { target: { value: "12/29/2026" } });
    expect(screen.queryByText(NOT_A_DATE)).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith("2026-12-29");
    expect(ref.current!.check()).toBe(true);
  });

  it("shows the problem when the form checks it on save, without a blur", () => {
    const { input, ref } = show();
    fireEvent.change(input, { target: { value: "02/30/2026" } });
    let ok = true;
    act(() => {
      ok = ref.current!.check();
    });
    expect(ok).toBe(false);
    expect(screen.getByText(NOT_A_DATE)).toBeTruthy();
  });

  it("lets an optional date stay empty, and asks for a required one", () => {
    const optional = show();
    fireEvent.blur(optional.input);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(optional.ref.current!.check()).toBe(true);
    cleanup();

    const required = show({ required: true });
    let ok = true;
    act(() => {
      ok = required.ref.current!.check();
    });
    expect(ok).toBe(false);
    expect(screen.getByRole("alert").textContent).toBe("Choose a date.");
  });

  it("refuses a day outside min and max with a plain line, never clamping it", () => {
    const { input, onChange } = show({ min: "2026-01-01", max: "2026-12-31" });
    fireEvent.change(input, { target: { value: "12/31/2025" } });
    fireEvent.blur(input);
    expect(screen.getByRole("alert").textContent).toBe("Choose Thursday, January 1, 2026 or later.");
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(input.value).toBe("12/31/2025");
    fireEvent.change(input, { target: { value: "01/01/2027" } });
    expect(screen.getByRole("alert").textContent).toBe("Choose Thursday, December 31, 2026 or earlier.");
  });

  it("shows a stored day the way she types it, with its hint", () => {
    const { input } = show({ value: "2026-11-05", hint: "Optional." });
    expect(input.value).toBe("11/05/2026");
    const ids = input.getAttribute("aria-describedby")!.split(" ");
    expect(ids.map((id) => document.getElementById(id)!.textContent)).toEqual([
      "That's Thursday, November 5, 2026.",
      "Optional.",
    ]);
  });

  it("typedDateProblem names each problem", () => {
    expect(typedDateProblem("")).toBeUndefined();
    expect(typedDateProblem(" ", { required: true })).toBe("Choose a date.");
    expect(typedDateProblem("11052026")).toBeUndefined();
    expect(typedDateProblem("13292026")).toBe(NOT_A_DATE);
  });
});

describe("TypedDateField keeps what she must see in view (batch-1029 re-check)", () => {
  it("scrolls the read-back into view while she types, and takes her to a bad date on save", () => {
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const { input, ref } = show();
      input.focus();
      fireEvent.change(input, { target: { value: "11052026" } });
      expect(scroll).toHaveBeenCalled();
      scroll.mockClear();
      fireEvent.change(input, { target: { value: "13292026" } });
      input.blur();
      act(() => {
        expect(ref.current?.check()).toBe(false);
      });
      expect(document.activeElement).toBe(input);
      expect(scroll).toHaveBeenCalledWith({ block: "center" });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
