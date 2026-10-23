import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@/data", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import { DesktopOnlyError } from "./documents";
import { askGemini, cancelAskGemini, watchAskGeminiProgress } from "./gemini";

beforeEach(() => {
  mocks.isTauri.mockReturnValue(true);
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
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
      requestId: "ask-service-test",
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
      requestId: "ask-service-test",
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
      requestId: expect.stringMatching(/^[A-Za-z0-9-]{1,64}$/),
      relativePath: "documents/test.pdf",
      materialId: "mat-1",
      context: "context text",
      question: "what is this?",
      history: [],
    });
  });
});


describe("interactive ask progress and cancel bridge", () => {
  it("listens on the ask event, forwards its payload and returns the unlistener", async () => {
    const stop = vi.fn();
    mocks.listen.mockResolvedValue(stop);
    const receive = vi.fn();
    expect(await watchAskGeminiProgress(receive)).toBe(stop);
    expect(mocks.listen).toHaveBeenCalledWith("ask-gemini-progress", expect.any(Function));
    const payload = { requestId: "ask-service-test", message: "Trying the backup Gemini model…" };
    mocks.listen.mock.calls[0]![1]({ payload });
    expect(receive).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("invokes cancellation with the frontend request id", async () => {
    await cancelAskGemini("ask-service-test");
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("cancel_ask_gemini", { requestId: "ask-service-test" });
  });

  it("does not invoke or listen outside the desktop app", async () => {
    mocks.isTauri.mockReturnValue(false);
    const stop = await watchAskGeminiProgress(vi.fn());
    stop();
    await cancelAskGemini("ask-service-test");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });
});
