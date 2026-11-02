/** Use the device's default voice; unavailable speech is a quiet no-op. */
export function canReadAloud(): boolean {
  try {
    return typeof window !== "undefined" && Boolean(window.speechSynthesis) &&
      typeof window.SpeechSynthesisUtterance === "function";
  } catch {
    return false;
  }
}

export function stopReading(): void {
  try {
    if (canReadAloud()) window.speechSynthesis.cancel();
  } catch { /* Some webviews expose speech but cannot use it. */ }
}

export function readAloud(text: string): SpeechSynthesisUtterance | null {
  try {
    if (!canReadAloud()) return null;
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
    return utterance;
  } catch {
    return null;
  }
}
