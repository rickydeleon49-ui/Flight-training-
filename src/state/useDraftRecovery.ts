import { useEffect, useRef, useState } from "react";

import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";

interface DraftRecovery {
  /** True when what is on screen came back from an interrupted session. */
  recovered: boolean;
  /**
   * Stop keeping this draft — after it is saved for real, or when she
   * chooses to throw the recovered text away.
   */
  forget: () => void;
}

/**
 * Keep a form's draft across leaving the page.
 *
 * On mount, anything stored under `key` is handed to `restore`. From then on
 * every change is mirrored to storage. `forget` is called by the form once
 * the work is safely in the database.
 */
export function useDraftRecovery<T>(
  key: string,
  value: T,
  restore: (draft: T) => void,
  /** Wait until the form has finished setting itself up. */
  ready = true,
): DraftRecovery {
  const [recovered, setRecovered] = useState(false);
  const checkedRef = useRef(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useEffect(() => {
    if (!ready || checkedRef.current) return;
    checkedRef.current = true;
    const saved = readDraft<T>(key);
    if (saved === null) return;
    restoreRef.current(saved);
    setRecovered(true);
  }, [key, ready]);

  useEffect(() => {
    // Only start mirroring once the recovery check has had its turn, or the
    // form's own starting values would immediately overwrite the draft.
    if (!ready || !checkedRef.current) return;
    const timer = window.setTimeout(() => writeDraft(key, value), 400);
    return () => window.clearTimeout(timer);
  }, [key, value, ready]);

  return {
    recovered,
    forget: () => {
      clearDraft(key);
      setRecovered(false);
    },
  };
}
