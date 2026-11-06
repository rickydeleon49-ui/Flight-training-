/**
 * "Ready" means ready after effects (FLAKE-01).
 *
 * A commit that comes from a promise (the app's startup load, a review session
 * that opens after a database read) is a default-priority render. React 19 doesn't
 * run its useEffects in that commit. It queues them as a Scheduler task. RTL's
 * waitFor/findBy can resolve before that task runs, and on a loaded CI runner it
 * often does. A test that acts then has a stale mount effect run after its first
 * event. Seen in CI: the Advanced fold closed again after the test opened it, a
 * typed date was put back to the stored one, and "Read aloud" was turned off again.
 */
import { act, waitFor, type waitForOptions } from "@testing-library/react";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect } from "vitest";

let committedStatus: string | undefined;

/**
 * Call in a test's Probe with the app data status. React runs all of a commit's
 * effects in one pass. So once this records "ready", the effects of every
 * component that mounted in the same commit have run too.
 */
export function useStatusAfterEffects(status: string): void {
  useEffect(() => {
    committedStatus = status;
    return () => {
      committedStatus = undefined;
    };
  }, [status]);
}

/** Waits until the app data is ready, with that commit's effects done. Use this, not `context.status`. */
export async function waitForReadyAfterEffects(options?: waitForOptions): Promise<void> {
  await waitFor(() => expect(committedStatus).toBe("ready"), options);
}

/**
 * Awaits a query (e.g. a findBy) and then runs any effects React still has
 * queued from the commit that query saw. React runs pending effects before it
 * starts any new render, so an empty render on a throwaway root, inside act,
 * runs them here and now.
 */
export async function afterEffects<T>(found: Promise<T>): Promise<T> {
  const result = await found;
  const root = createRoot(document.createElement("div"));
  act(() => root.render(null));
  act(() => root.unmount());
  return result;
}
