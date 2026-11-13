// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import type { GeminiJob } from "@/state/GeminiJobs";
import { WaitingAnswerLinks } from "./WaitingAnswerLinks";

const FULL = "Several finished answers are waiting to be saved or discarded. Save or discard one of them first, so none is lost.";
const materials = [
  { id: "a", title: "Airspace Chapter" },
  { id: "b", title: "Weather Notes" },
  { id: "c", title: "Not waiting" },
];
const job = (materialId: string, phase: string) => ({ materialId, phase, answer: {} }) as unknown as GeminiJob;

afterEach(cleanup);

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
});
