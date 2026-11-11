// @vitest-environment jsdom
import { createElement as h, useMemo, useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PageHeader } from "./PageHeader";
import { TopBar } from "./TopBar";
import { TopBarContext } from "./topBarContext";

let callback: IntersectionObserverCallback;
const disconnect = vi.fn();

beforeEach(() => {
  class FakeObserver {
    constructor(cb: IntersectionObserverCallback) { callback = cb; }
    observe() {}
    disconnect = disconnect;
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); disconnect.mockClear(); });

function Shell({ back, page }: { back: boolean; page: boolean }) {
  const [title, setTitle] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const value = useMemo(() => ({ title, setTitle, collapsed, setCollapsed }), [title, collapsed]);
  return h(
    TopBarContext.Provider,
    { value },
    h(MemoryRouter, { initialEntries: ["/study/m-1"] }, h(TopBar, { back }), page ? h(PageHeader, { title: "Logbook" }) : null),
  );
}
const leave = (leaving: boolean) =>
  act(() => callback([{ isIntersecting: !leaving, boundingClientRect: { top: leaving ? -80 : 20 } } as IntersectionObserverEntry], {} as IntersectionObserver));

describe("TopBar", () => {
  it("shows the title once the heading leaves, and hides it when it returns", () => {
    const { container } = render(h(Shell, { back: false, page: true }));
    expect(container.querySelector(".top-bar.is-collapsed")).toBeNull();
    leave(true);
    expect(container.querySelector(".top-bar.is-collapsed .top-bar__title")?.textContent).toBe("Logbook");
    leave(false);
    expect(container.querySelector(".top-bar.is-collapsed")).toBeNull();
  });

  it("clears on unmount", () => {
    const { container, rerender } = render(h(Shell, { back: false, page: true }));
    leave(true);
    rerender(h(Shell, { back: false, page: false }));
    expect(disconnect).toHaveBeenCalled();
    expect(container.querySelector(".top-bar.is-collapsed")).toBeNull();
    expect(container.querySelector(".top-bar__title")?.textContent).toBe("");
  });

  it("has a back button only when asked for", () => {
    render(h(Shell, { back: true, page: false }));
    expect(screen.getByRole("button", { name: "Back to Study" })).toBeTruthy();
    cleanup();
    render(h(Shell, { back: false, page: false }));
    expect(screen.queryByRole("button")).toBeNull();
  });
});
