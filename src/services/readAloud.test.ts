// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { mockSpeechSynthesis } from "@/testing/mockSpeechSynthesis";
import { canReadAloud, readAloud, stopReading } from "./readAloud";

afterEach(() => vi.unstubAllGlobals());

it("quietly does nothing without both speech APIs", () => {
  mockSpeechSynthesis();
  vi.stubGlobal("speechSynthesis", undefined);
  expect(canReadAloud()).toBe(false);
  expect(readAloud("Question")).toBeNull();
  expect(() => stopReading()).not.toThrow();
  mockSpeechSynthesis();
  vi.stubGlobal("SpeechSynthesisUtterance", undefined);
  expect(canReadAloud()).toBe(false);
  expect(readAloud("Question")).toBeNull();
});

it("cancels before speaking in en-US with the default voice, and stops", () => {
  const { cancel, speak } = mockSpeechSynthesis();
  expect(canReadAloud()).toBe(true);
  const utterance = readAloud("Fictional question?");
  expect(utterance?.text).toBe("Fictional question?");
  expect(utterance?.lang).toBe("en-US");
  expect(utterance?.voice).toBeNull();
  expect(speak).toHaveBeenCalledWith(utterance);
  expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(speak.mock.invocationCallOrder[0]!);
  stopReading();
  expect(cancel).toHaveBeenCalledTimes(2);
});

it("never throws when the webview rejects speech or cancellation", () => {
  const { cancel, speak } = mockSpeechSynthesis();
  speak.mockImplementation(() => { throw new Error("Unavailable"); });
  expect(readAloud("Question")).toBeNull();
  cancel.mockImplementation(() => { throw new Error("Unavailable"); });
  expect(readAloud("Question")).toBeNull();
  expect(() => stopReading()).not.toThrow();
  Object.defineProperty(window, "speechSynthesis", { configurable: true, get() { throw new Error("Unavailable"); } });
  expect(canReadAloud()).toBe(false);
});
