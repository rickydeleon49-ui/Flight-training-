import { useEffect, useRef, useSyncExternalStore } from "react";

// One visible picture surface across normal review, homework and the editor.
// Returning from a modal resumes the prior picture; no deck is preloaded.
const owners: symbol[] = [];
const listeners = new Set<() => void>();

const publish = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function remove(owner: symbol) {
  const i = owners.indexOf(owner);
  if (i >= 0) owners.splice(i, 1);
}

export function useVisualImageLease(enabled: boolean) {
  const owner = useRef(Symbol("picture")).current;
  const activate = () => {
    remove(owner);
    owners.push(owner);
    publish();
  };
  useEffect(() => {
    if (!enabled) return;
    activate();
    return () => {
      remove(owner);
      publish();
    };
  }, [enabled, owner]);
  const active = useSyncExternalStore(
    subscribe,
    () => enabled && owners[owners.length - 1] === owner,
    () => false,
  );
  return { active, activate };
}
