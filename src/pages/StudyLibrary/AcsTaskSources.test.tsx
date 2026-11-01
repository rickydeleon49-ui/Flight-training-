// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@/data";
import { AcsTaskSources } from "./AcsTaskSources";
import { AcsTaskChip } from "./AcsTaskChip";

vi.mock("@/data", () => ({ isTauri: vi.fn(() => false) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(isTauri).mockReturnValue(false); });
afterEach(cleanup);
function expand() { fireEvent.click(screen.getByText("Official sources")); }

it("starts closed and lists the task's plain source names and exact edition footer", () => {
  const { container } = render(<AcsTaskSources code="PA.I.A" />);
  expect(container.querySelector("details")!.open).toBe(false);
  expand();
  expect(screen.getByRole("link", { name: "Pilot’s Handbook of Aeronautical Knowledge" }).getAttribute("href"))
    .toBe("https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/phak");
  expect(screen.getByRole("link", { name: "Pilot certification" })).toBeTruthy();
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "Pilot certification", "BasicMed medical requirements", "General operating and flight rules", "BasicMed",
    "Risk Management Handbook", "Airplane Flying Handbook", "Pilot’s Handbook of Aeronautical Knowledge",
  ]);
  for (const item of screen.getAllByRole("listitem")) expect(within(item).getAllByRole("link")).toHaveLength(1);
  expect(container.textContent).toContain("From FAA-S-ACS-6C (November 2023, effective May 31, 2024). Check the current FAA version.");
  expect(screen.getByRole("link", { name: "Check the current FAA version." }).getAttribute("href"))
    .toBe("https://www.faa.gov/training_testing/testing/acs");
});
it("renders nothing for unknown or absent codes", () => {
  const view = render(<AcsTaskSources code="unknown" />);
  expect(view.container.textContent).toBe("");
  view.rerender(<AcsTaskSources />);
  expect(view.container.textContent).toBe("");
});
it("keeps chips plain unless sources are requested and leaves unlinked references as text", () => {
  const view = render(<AcsTaskChip code="PA.I.F" />);
  expect(screen.queryByText("Official sources")).toBeNull();
  view.rerender(<AcsTaskChip code="PA.I.F" showSources />); expand();
  const plain = screen.getByText("Use your airplane’s operating handbook or flight manual.");
  expect(plain.tagName).toBe("LI");
  expect(plain.children).toHaveLength(0);
  expect(within(plain).queryByRole("link")).toBeNull();
  expect(screen.queryByRole("link", { name: /operating handbook/ })).toBeNull();
});
it("preserves browser anchor navigation and opens desktop source and edition links with the opener", () => {
  render(<AcsTaskSources code="PA.I.A" />); expand();
  const source = screen.getByRole("link", { name: "Pilot’s Handbook of Aeronautical Knowledge" });
  expect(fireEvent.click(source)).toBe(true);
  expect(source.getAttribute("target")).toBe("_blank");
  expect(source.getAttribute("rel")).toBe("noopener noreferrer");
  expect(openUrl).not.toHaveBeenCalled();
  vi.mocked(isTauri).mockReturnValue(true);
  expect(fireEvent.click(source)).toBe(false);
  fireEvent.click(screen.getByRole("link", { name: "Check the current FAA version." }));
  expect(openUrl).toHaveBeenNthCalledWith(1, source.getAttribute("href"));
  expect(openUrl).toHaveBeenNthCalledWith(2, "https://www.faa.gov/training_testing/testing/acs");
});
it("shows a quiet error when the desktop opener fails", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(openUrl).mockRejectedValueOnce(new Error("synthetic"));
  render(<AcsTaskSources code="PA.I.A" />); expand();
  fireEvent.click(screen.getByRole("link", { name: "Pilot certification" }));
  expect((await screen.findByRole("alert")).textContent).toContain("That link couldn't be opened.");
});
