import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Keeps a flashcard from changing height when it flips between question and
 * answer: the card never gets shorter than the tallest side seen for this card,
 * so nothing below it jumps (with keepAcrossCards, the tallest card seen so far). A longer answer still grows the card (no clipping).
 */
export function useStickyCardHeight(ref: RefObject<HTMLElement | null>, cardKey: string | number, revealed: boolean, keepAcrossCards = false) {
  const seen = useRef<{ key: string | number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (seen.current?.key !== cardKey) {
      // keepAcrossCards: the tallest card of the session is the floor, so the buttons below stay put.
      if (!keepAcrossCards) element.style.minHeight = "";
      seen.current = { key: cardKey, height: keepAcrossCards ? seen.current?.height ?? 0 : 0 };
    }
    seen.current.height = Math.max(seen.current.height, element.offsetHeight);
    element.style.minHeight = `${seen.current.height}px`;
  }, [ref, cardKey, revealed]);
}
