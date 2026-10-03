/**
 * Remove a browser API for a test, the way an older engine would lack it, and
 * put back exactly what was there. Used to exercise compatibility fallbacks:
 * the API is made `undefined`, never replaced with a working stand-in.
 */
export function removeCapability(target: object, key: PropertyKey): () => void {
  const own = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { value: undefined, configurable: true, writable: true });
  if ((target as Record<PropertyKey, unknown>)[key] !== undefined) {
    throw new Error(`Could not remove ${String(key)} for the test.`);
  }
  return () => {
    if (own) Object.defineProperty(target, key, own);
    else delete (target as Record<PropertyKey, unknown>)[key];
  };
}

/** Remove several capabilities; the returned function restores them in reverse. */
export function removeCapabilities(entries: Array<[object, PropertyKey]>): () => void {
  const restores = entries.map(([target, key]) => removeCapability(target, key));
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}
