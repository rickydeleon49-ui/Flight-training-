import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Keeps a flashcard from changing height when it flips between question and
 * answer: the card never gets shorter than the tallest side seen for this card,
 * so nothing below it jumps. A longer answer still grows the card (no clipping).
 */
export function useStickyCardHeight(ref: RefObject<HTMLElement | null>, cardKey: string | number, revealed: boolean) {
  const seen = useRef<{ key: string | number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (seen.current?.key !== cardKey) {
      element.style.minHeight = "";
      seen.current = { key: cardKey, height: 0 };
    }
    seen.current.height = Math.max(seen.current.height, element.offsetHeight);
    element.style.minHeight = `${seen.current.height}px`;
  }, [ref, cardKey, revealed]);
}
