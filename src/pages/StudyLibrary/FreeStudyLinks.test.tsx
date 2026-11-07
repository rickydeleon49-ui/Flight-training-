// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FreeStudyLinks, FREE_STUDY_LINKS } from "./FreeStudyLinks";
vi.mock("@/data", () => ({ isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("free study links card", () => {
  it("is closed by default with 10 https links and no forums", () => {
    render(<FreeStudyLinks />);
    expect(document.querySelector("details")!.open).toBe(false);
    expect(screen.getAllByRole("link", { hidden: true })).toHaveLength(10);
    for (const link of FREE_STUDY_LINKS) {
      expect(link.url.startsWith("https://")).toBe(true);
      expect(link.url.toLowerCase()).not.toContain("reddit");
      expect(link.why.length).toBeLessThanOrEqual(70);
    }
  });
  it("opens a tapped link through the opener", () => {
    render(<FreeStudyLinks />);
    fireEvent.click(screen.getByText("CFI Notebook"));
    expect(openUrl).toHaveBeenCalledWith("https://www.cfinotebook.net/");
  });
  it("shows a hidden chevron and toggles aria-expanded", async () => {
    render(<FreeStudyLinks />);
    const summary = document.querySelector("summary")!;
    const chevron = screen.getByTestId("free-links-chevron");
    expect(chevron.getAttribute("aria-hidden")).toBe("true");
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    const details = document.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await waitFor(() => expect(summary.getAttribute("aria-expanded")).toBe("true"));
  });
});
