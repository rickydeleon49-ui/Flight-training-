// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { mockSpeechSynthesis } from "@/testing/mockSpeechSynthesis";
import { ReadAloudButton } from "./ReadAloudButton";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("renders nothing when unsupported", () => {
  vi.stubGlobal("speechSynthesis", undefined);
  const { container } = render(h(ReadAloudButton, { text: "Question" }));
  expect(container.innerHTML).toBe("");
});

it("shows Stop while reading, resets on completion or error, and stops on click", () => {
  const { cancel, speak } = mockSpeechSynthesis();
  render(h(ReadAloudButton, { text: "Question" }));
  for (const event of ["end", "error"] as const) {
    fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    const utterance = speak.mock.lastCall![0];
    // The lightweight mock exposes the native callback properties.
    act(() => utterance[event === "end" ? "onend" : "onerror"]?.call(utterance, {} as SpeechSynthesisEvent & SpeechSynthesisErrorEvent));
    expect(screen.getByRole("button", { name: "Read aloud" })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  cancel.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(cancel).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Read aloud" })).toBeTruthy();
});

it("stops on changed text and unmount and ignores an old completion", () => {
  const { cancel, speak } = mockSpeechSynthesis();
  const view = render(h(ReadAloudButton, { text: "First question" }));
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  const old = speak.mock.lastCall![0];
  cancel.mockClear();
  view.rerender(h(ReadAloudButton, { text: "Next question" }));
  expect(cancel).toHaveBeenCalledOnce();
  expect(old.onend).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  expect(speak.mock.lastCall![0].text).toBe("Next question");
  cancel.mockClear();
  view.unmount();
  expect(cancel).toHaveBeenCalledOnce();
});

it("keeps the label ready if speech fails", () => {
  const { speak } = mockSpeechSynthesis();
  speak.mockImplementation(() => { throw new Error("Unavailable"); });
  render(h(ReadAloudButton, { text: "Question" }));
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  expect(screen.getByRole("button", { name: "Read aloud" })).toBeTruthy();
});
