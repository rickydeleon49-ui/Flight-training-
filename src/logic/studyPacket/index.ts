/**
 * Structured study-packet validation (`hfd-study-packet` version 1).
 * Contract: docs/STRUCTURED_STUDY_IMPORT_CONTRACT_2026-10-03.md.
 * Slice A only: validation and preview data. Nothing here saves anything.
 */
export { validatePacketBytes, validatePacketText } from "./validate";
export { canonicalPersistenceJson } from "./payload";
export { FORMAT, FORMAT_VERSION, LIMITS } from "./limits";
export type * from "./types";
