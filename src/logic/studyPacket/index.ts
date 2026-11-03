/**
 * Structured study-packet validation (`hfd-study-packet` version 1).
 * Slice A only: validation and preview data. Nothing here saves anything.
 */
export { validatePacketBytes, validatePacketText } from "./validate";
export { canonicalPersistenceJson } from "./payload";
export { FORMAT, FORMAT_VERSION, LIMITS } from "./limits";
export type * from "./types";
