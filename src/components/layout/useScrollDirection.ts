import { useEffect, useState } from "react";

const COMPACT_AFTER = 80;
const MIN_DELTA = 8;

/**
 * True while the page is being scrolled down past 80px; false when scrolling
 * up or at the top. One passive window listener, throttled to a frame. Events
 * at the very top or bottom are ignored (iOS rubber-banding), a move under 8px
 * changes nothing, and a new `resetKey` (the route) goes back to expanded.
 */
export function useScrollDirection(resetKey?: string): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    setCompact(false);
    let anchor = window.scrollY;
    let frame = 0;

    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight - 1;
      if (y <= 0 || y >= max) return;
      const delta = y - anchor;
      if (Math.abs(delta) < MIN_DELTA) return;
      anchor = y;
      if (delta > 0) {
        if (y > COMPACT_AFTER) setCompact(true);
      } else {
        setCompact(false);
      }
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [resetKey]);

  return compact;
}
