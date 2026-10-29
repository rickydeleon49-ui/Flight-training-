import { useState } from "react";

// Same key as before STUDY-HOWTO-01, so a saved Hide tips choice still applies.
const TIPS_KEY = "hfd:material-start-here:hidden";

/** The material page's Hide tips preference, remembered for this viewer. */
export function useMaterialTips() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(TIPS_KEY) === "1"; } catch { return false; }
  });
  const changeHidden = (next: boolean) => {
    setHidden(next);
    try { localStorage.setItem(TIPS_KEY, next ? "1" : "0"); } catch { /* Tips still work without storage. */ }
  };
  return { hidden, setHidden: changeHidden };
}
