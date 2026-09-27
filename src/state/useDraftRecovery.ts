import { useLayoutEffect, useRef, useState } from "react";

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
  const checkedRef = useRef<string | null>(null);
  const skipMirror = useRef(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useLayoutEffect(() => {
    if (!ready || checkedRef.current === key) return;
    checkedRef.current = key;
    const saved = readDraft<T>(key);
    if (saved === null) return;
    skipMirror.current = true;
    restoreRef.current(saved);
    setRecovered(true);
  }, [key, ready]);

  useLayoutEffect(() => {
    // Only start mirroring once the recovery check has had its turn, or the
    // form's own starting values would immediately overwrite the draft.
    if (!ready || checkedRef.current !== key) return;
    if (skipMirror.current) {
      skipMirror.current = false;
      return;
    }
    // Commit before paint. Cancelling a debounce on navigation lost the last
    // 400 ms of typing, and async unload work cannot finish after webview exit.
    writeDraft(key, value);
  }, [key, value, ready]);

  return {
    recovered,
    forget: () => {
      skipMirror.current = true;
      clearDraft(key);
      setRecovered(false);
    },
  };
}
