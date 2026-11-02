import { vi } from "vitest";

export function mockSpeechSynthesis() {
  const cancel = vi.fn();
  const speak = vi.fn<(utterance: SpeechSynthesisUtterance) => void>();
  vi.stubGlobal("speechSynthesis", { cancel, speak });
  vi.stubGlobal("SpeechSynthesisUtterance", class {
    lang = "";
    voice = null;
    onend = null;
    onerror = null;
    constructor(public text: string) {}
  });
  return { cancel, speak };
}
