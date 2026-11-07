import { useEffect } from "react";

/** Space with no focused card or control should leave review where it is. */
export function useReviewBodySpace() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === " " || event.key === "Spacebar") &&
          (event.target === document.body || event.target === document.documentElement)) {
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
