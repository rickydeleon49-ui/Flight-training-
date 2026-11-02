import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** Session-only positions belong to history entries, rather than page URLs. */
export function useHistoryScroll() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const positions = useRef(new Map<string, [number, number]>());
  const previous = useRef(location);

  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = location;
    const target = positions.current.get(location.key);
    let restoring = navigationType === "POP" && !location.hash && Boolean(target);
    let frame = 0;
    let observer: ResizeObserver | undefined;
    const stop = () => { restoring = false; observer?.disconnect(); cancelAnimationFrame(frame); };
    const restore = () => {
      frame = requestAnimationFrame(() => {
        if (!restoring || !target) return;
        window.scrollTo?.(...target);
        // A suspended page or an async list can initially be too short. Retry
        // when its content grows, without replacing the saved position with 0.
        if (document.documentElement.scrollHeight - window.innerHeight >= target[1]) stop();
      });
    };
    const nativeRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    if (restoring) {
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => { cancelAnimationFrame(frame); restore(); });
        observer.observe(document.body);
      }
      restore();
    } else if (navigationType === "PUSH" && (old.pathname !== location.pathname || (location.state as { scrollToTop?: boolean } | null)?.scrollToTop) && !location.hash) {
      window.scrollTo?.(0, 0);
    }
    const save = () => {
      if (!restoring) positions.current.set(location.key, [window.scrollX, window.scrollY]);
    };
    // User intent wins over a restoration still waiting for content.
    const interrupt = () => { stop(); save(); };
    save();
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("wheel", interrupt, { passive: true });
    window.addEventListener("touchstart", interrupt, { passive: true });
    window.addEventListener("keydown", interrupt);
    return () => {
      stop();
      window.history.scrollRestoration = nativeRestoration;
      window.removeEventListener("scroll", save);
      window.removeEventListener("wheel", interrupt);
      window.removeEventListener("touchstart", interrupt);
      window.removeEventListener("keydown", interrupt);
    };
  }, [location.key, location.pathname, location.hash, navigationType]);
}
