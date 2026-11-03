// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BackToTop } from "./BackToTop";
import { Dialog } from "./Dialog";

beforeEach(() => {
  vi.stubGlobal("scrollY", 0);
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function scrollTo(y: number) {
  vi.stubGlobal("scrollY", y);
  fireEvent.scroll(window);
}
function page() {
  render(h("main", null, h("h1", null, "Study Library"), h(BackToTop)));
}
const button = () => screen.queryByRole("button", { name: "Back to top" });

it("appears only beyond one viewport and hides again at the top", () => {
  page();
  expect(button()).toBeNull();
  scrollTo(800);
  expect(button()).toBeNull();
  scrollTo(801);
  expect(button()).not.toBeNull();
  scrollTo(0);
  expect(button()).toBeNull();
});

it("checks initial scroll and rechecks the viewport on resize", () => {
  vi.stubGlobal("scrollY", 900);
  page();
  expect(button()).not.toBeNull();
  vi.stubGlobal("innerHeight", 1000);
  fireEvent.resize(window);
  expect(button()).toBeNull();
});

it("scrolls smoothly and focuses the page heading without an instant focus scroll", () => {
  page();
  scrollTo(900);
  const heading = screen.getByRole("heading", { level: 1 });
  const focus = vi.spyOn(heading, "focus");
  fireEvent.click(button()!);
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(document.activeElement).toBe(heading);
});

it("hides for an open dialog and returns when the dialog closes", async () => {
  page();
  scrollTo(900);
  const dialog = document.createElement("dialog");
  document.body.append(dialog);
  dialog.setAttribute("open", "");
  await waitFor(() => expect(button()).toBeNull());
  dialog.removeAttribute("open");
  await waitFor(() => expect(button()).not.toBeNull());
  dialog.remove();
});

it("also hides for the app's fallback dialog and returns after unmount", async () => {
  page();
  scrollTo(900);
  const modal = render(h(Dialog, { open: true, onClose: vi.fn(), title: "Study", children: "Notes" }));
  await waitFor(() => expect(button()).toBeNull());
  modal.unmount();
  await waitFor(() => expect(button()).not.toBeNull());
});

it("keeps a round 44 px target on Mac and clears the phone safe area", () => {
  const css = readFileSync("src/components/ui/ui.css", "utf8");
  expect(css).toMatch(/\.back-to-top\s*\{[^}]*position: fixed;[^}]*right:[^;]+;[^}]*bottom:[^;]+;[^}]*width: 44px;[^}]*height: 44px;[^}]*border-radius: 50%/);
  expect(css).toMatch(/@media \(max-width: 999px\)\s*\{\s*\.back-to-top\s*\{[^}]*safe-area-inset-right[^}]*safe-area-inset-bottom/);
});
