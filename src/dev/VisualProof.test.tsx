// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom cannot decode images; the header guard has its own tests.
vi.mock("@/logic/visualPng", () => ({
  readProofPng: vi.fn(async () => ({ width: 480, height: 240, url: "data:image/png;base64,AAAA" })),
}));

import VisualProof, { Recall } from "./VisualProof";

const ANSWER = "Charlie-Zulu-Answer";
const QUESTION = "Which part is on the right";

afterEach(cleanup);

describe("Recall", () => {
  it("keeps the answer out of the DOM until the deliberate reveal, then announces it politely", () => {
    const { container, rerender } = render(<Recall question={QUESTION} answer={ANSWER} revealed={false} onReveal={() => {}} />);
    expect(container.innerHTML).not.toContain(ANSWER);
    expect(screen.getByRole("button", { name: `Covered label 1. ${QUESTION}. Reveal label` })).toBeTruthy();
    const live = container.querySelector("[aria-live='polite']");
    expect(live).not.toBeNull();
    expect(live!.textContent).toBe("");

    rerender(<Recall question={QUESTION} answer={ANSWER} revealed onReveal={() => {}} />);
    expect(container.querySelector("[aria-live='polite']")!.textContent).toBe(ANSWER);
  });
});

describe("VisualProof session", () => {
  let setItem: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    setItem = vi.spyOn(Storage.prototype, "setItem");
  });
  afterEach(() => setItem.mockRestore());

  async function author() {
    fireEvent.click(screen.getByRole("button", { name: "Cover a label" }));
    expect(screen.getByRole("heading", { name: "Try it — this is not saved", level: 2 })).toBeTruthy();
    const file = new File([new Uint8Array([1])], "practice-panel.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choose one PNG picture"), { target: { files: [file] } });
    await screen.findByText("Covered label 1");
  }

  it("runs Cover → Try to remember → Reveal → Show whole picture without leaking or saving", async () => {
    render(<VisualProof />);
    await author();

    // The picture is hidden from assistive technology and carries no text alternative.
    const svg = document.querySelector("svg.proof-stage")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector("title, desc")).toBeNull();
    expect(svg.querySelector("image")!.getAttribute("alt")).toBeNull();

    fireEvent.change(screen.getByLabelText("Question"), { target: { value: QUESTION } });
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: ANSWER } });

    // Keyboard placement: Arrow = 1 px, Shift+Arrow = 10 px.
    const left = screen.getByLabelText("Left") as HTMLInputElement;
    const before = Number(left.value);
    const mover = screen.getByRole("button", { name: /Cover 1: use arrow keys/ });
    fireEvent.keyDown(mover, { key: "ArrowRight" });
    fireEvent.keyDown(mover, { key: "ArrowRight", shiftKey: true });
    expect(Number(left.value)).toBe(before + 11);

    fireEvent.click(screen.getByRole("button", { name: "Try to remember" }));
    // Not anywhere in the document: no input value, alt, title, aria or offscreen text.
    expect(document.documentElement.outerHTML).not.toContain(ANSWER);
    expect(document.querySelector("[data-cover]")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: `Covered label 1. ${QUESTION}. Reveal label` }));
    expect(document.querySelector("[aria-live='polite']")!.textContent).toBe(ANSWER);
    expect(document.querySelector("[data-cover]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show whole picture" }));
    expect(screen.getByText(/whole picture, from the same bytes/)).toBeTruthy();

    // Try again re-covers in the same render.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(document.querySelector("[data-cover]")).not.toBeNull();
    expect(document.documentElement.outerHTML).not.toContain(ANSWER);

    expect(setItem).not.toHaveBeenCalled();
  });

  it("Close discards the picture, cover, question and answer; re-entry starts empty and covered", async () => {
    render(<VisualProof />);
    await author();
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: QUESTION } });
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: ANSWER } });
    fireEvent.click(screen.getByRole("button", { name: "Try to remember" }));
    fireEvent.click(screen.getByRole("button", { name: /Reveal label/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close — nothing is kept" }));

    expect(document.documentElement.outerHTML).not.toContain(ANSWER);
    expect(document.documentElement.outerHTML).not.toContain(QUESTION);
    expect(document.querySelector("svg.proof-stage")).toBeNull();

    await author();
    expect((screen.getByLabelText("Question") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Answer") as HTMLInputElement).value).toBe("");
    expect(document.querySelector("[data-cover]")).not.toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });
});
