import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}));

vi.mock("@/data", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { DesktopOnlyError } from "./documents";
import { askGemini } from "./gemini";

beforeEach(() => {
  mocks.isTauri.mockReturnValue(true);
  mocks.invoke.mockReset();
});

describe("askGemini service", () => {
  it("refuses outside the desktop app with DesktopOnlyError", async () => {
    mocks.isTauri.mockReturnValue(false);
    await expect(
      askGemini({
        materialId: "mat-1",
        context: "test context",
        question: "test question",
      }),
    ).rejects.toBeInstanceOf(DesktopOnlyError);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("invokes ask_gemini with correct payload when desktop is available", async () => {
    mocks.invoke.mockResolvedValue({
      answer: "Sample answer",
      sourcePages: [3],
    });

    const res = await askGemini({
      relativePath: "documents/test.pdf",
      materialId: "mat-1",
      context: "context text",
      question: "what is this?",
      history: [{ role: "user", text: "prior q" }],
    });

    expect(res).toEqual({
      answer: "Sample answer",
      sourcePages: [3],
    });
    expect(mocks.invoke).toHaveBeenCalledWith("ask_gemini", {
      relativePath: "documents/test.pdf",
      materialId: "mat-1",
      context: "context text",
      question: "what is this?",
      history: [{ role: "user", text: "prior q" }],
    });
  });

  it("works with positional arguments as well", async () => {
    mocks.invoke.mockResolvedValue({
      answer: "Positional answer",
      sourcePages: [],
    });

    const res = await askGemini(
      "documents/test.pdf",
      "mat-1",
      "context text",
      "what is this?",
    );

    expect(res).toEqual({
      answer: "Positional answer",
      sourcePages: [],
    });
    expect(mocks.invoke).toHaveBeenCalledWith("ask_gemini", {
      relativePath: "documents/test.pdf",
      materialId: "mat-1",
      context: "context text",
      question: "what is this?",
      history: [],
    });
  });
});
