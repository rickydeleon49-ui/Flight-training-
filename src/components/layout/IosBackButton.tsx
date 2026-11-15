import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { useGuardedNavigate } from "@/state/leaveGuard";
import { backTarget } from "./iosBack";

const clean = (path: string) => path.replace(/\/+$/, "") || "/";

/** iPhone only: a back button at the top left of every page that isn't a tab's first page. */
export function IosBackButton() {
  const { pathname } = useLocation();
  const navigate = useGuardedNavigate();
  const current = useRef(pathname);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (current.current !== pathname) {
      previous.current = current.current;
      current.current = pathname;
    }
  }, [pathname]);

  const target = backTarget(pathname);
  if (!target) return null;

  const goBack = () => {
    // Going back in history keeps the page's scroll position; a deep link has no such entry.
    if (previous.current !== null && clean(previous.current) === target.to) navigate(-1);
    else navigate(target.to);
  };

  return (
    <button type="button" className="ios-back" aria-label={`Back to ${target.label}`} onClick={goBack}>
      <span className="ios-back__chevron" aria-hidden="true">‹</span>
      <span className="ios-back__label">{target.label}</span>
    </button>
  );
}
