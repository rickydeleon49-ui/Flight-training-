import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Open one item from an offline-search link (OFFLINE-02c §4), such as
 * `/notes?note=<id>`. Only an id that exists is used: `reveal` makes sure a
 * filter isn't hiding it, and the page scrolls to the element with id
 * `<param>-<id>` once. An id that doesn't exist reports `missing`, so the page
 * can say the item isn't here any more.
 */
export function useSearchFocus(
  param: string,
  exists: (id: string) => boolean,
  reveal: (id: string) => void,
  /** Changes when the shown list changes, so the scroll can wait for it. */
  shownKey: unknown,
): { focusId: string | null; missing: boolean } {
  const [params] = useSearchParams();
  const id = params.get(param);
  const found = id !== null && exists(id);
  const revealed = useRef<string | null>(null);
  const scrolled = useRef<string | null>(null);

  useEffect(() => {
    if (found && revealed.current !== id) {
      revealed.current = id;
      reveal(id);
    }
    // `reveal` is a fresh closure each render; the id decides.
  }, [id, found]);

  useEffect(() => {
    if (!found || scrolled.current === id) return;
    const element = document.getElementById(`${param}-${id}`);
    if (!element) return;
    scrolled.current = id;
    element.scrollIntoView?.({ block: "center" });
  }, [param, id, found, shownKey]);

  return { focusId: found ? id : null, missing: id !== null && !found };
}
