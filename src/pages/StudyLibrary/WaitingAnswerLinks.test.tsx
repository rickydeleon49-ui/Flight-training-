// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GeminiJob } from "@/state/GeminiJobs";
import { WaitingAnswerLinks } from "./WaitingAnswerLinks";

const kitJobs = vi.hoisted(() => ({ list: vi.fn(async () => [] as { materialId: string }[]) }));
vi.mock("@/services/documents", () => ({ listPdfStudyKitJobs: kitJobs.list }));
const WAITING = "A finished answer for this document is waiting to be saved or discarded. Save or discard it first, so it is not lost.";
const FULL = "Several finished answers are waiting to be saved or discarded. Save or discard one of them first, so none is lost.";
const materials = [
  { id: "a", title: "Airspace Chapter" },
  { id: "b", title: "Weather Notes" },
  { id: "c", title: "Not waiting" },
];
const job = (materialId: string, phase: string) => ({ materialId, phase, answer: {} }) as unknown as GeminiJob;

afterEach(() => {
  cleanup();
  kitJobs.list.mockResolvedValue([]);
});

describe("WaitingAnswerLinks", () => {
  it("names each material with a waiting answer and links to its page", () => {
    render(
      <MemoryRouter>
        <WaitingAnswerLinks message={FULL} jobs={[job("a", "recovered"), job("b", "save-failed"), job("c", "running")]} materials={materials} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Airspace Chapter" }).getAttribute("href")).toBe("/study/a");
    expect(screen.getByRole("link", { name: "Weather Notes" }).getAttribute("href")).toBe("/study/b");
    expect(screen.queryByRole("link", { name: "Not waiting" })).toBeNull();
  });

  it("shows nothing for other messages", () => {
    const { container } = render(
      <MemoryRouter>
        <WaitingAnswerLinks message="Gemini is busy." jobs={[job("a", "recovered")]} materials={materials} />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe("");
  });

  it("counts pdf-kit drafts that hold a slot", async () => {
    kitJobs.list.mockResolvedValue([{ materialId: "b" }]);
    render(
      <MemoryRouter>
        <WaitingAnswerLinks message={FULL} jobs={[]} materials={materials} />
      </MemoryRouter>,
    );
    expect((await screen.findByRole("link", { name: "Weather Notes" })).getAttribute("href")).toBe("/study/b");
  });

  it("shows a Show me link for the waiting refusal", () => {
    render(
      <MemoryRouter>
        <WaitingAnswerLinks message={WAITING} jobs={[job("a", "recovered")]} materials={materials} exceptId="a" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Show me" }).getAttribute("href")).toBe("/study/a");
  });

  it("lists waiting-for-her and discard-failed but not cancelled or superseded", () => {
    render(
      <MemoryRouter>
        <WaitingAnswerLinks
          message={FULL}
          jobs={[job("a", "waiting-for-her"), job("b", "discard-failed"), job("c", "cancelled"), job("d", "superseded")]}
          materials={[...materials, { id: "d", title: "Old" }]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Airspace Chapter" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Weather Notes" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Not waiting" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Old" })).toBeNull();
  });

  it("never renders empty when the message matched", () => {
    const { container } = render(
      <MemoryRouter>
        <WaitingAnswerLinks message={FULL} jobs={[]} materials={materials} />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("open the document with a finished answer");
  });
});
