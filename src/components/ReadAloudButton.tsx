import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { canReadAloud, readAloud, stopReading } from "@/services/readAloud";

export function ReadAloudButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const current = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setSpeaking(false);
    return () => {
      if (current.current) {
        current.current.onend = null;
        current.current.onerror = null;
        current.current = null;
      }
      stopReading();
    };
  }, [text]);

  if (!canReadAloud()) return null;

  const toggle = () => {
    if (speaking) {
      stopReading();
      setSpeaking(false);
      return;
    }
    const utterance = readAloud(text);
    current.current = utterance;
    setSpeaking(Boolean(utterance));
    if (utterance) {
      const finish = () => {
        if (current.current === utterance) setSpeaking(false);
      };
      utterance.onend = finish;
      utterance.onerror = finish;
    }
  };

  return <Button size="small" variant="ghost" onClick={toggle}>{speaking ? "Stop" : "Read aloud"}</Button>;
}
