/**
 * Small helpers shared by eager code and the practice transactions. Kept apart from
 * practiceSessionTransaction.ts so that large module can load on first write.
 */
import type { SqlValue } from "./db";

export type Query = (sql: string, params: SqlValue[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isUuidV4(value: string): boolean {
  return typeof value === "string" && UUID_V4.test(value);
}

export function codePointLength(str: string): number {
  return Array.from(str).length;
}

/** Formats JSON canonically with sorted object keys and compact whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (key) =>
          JSON.stringify(key) +
          ":" +
          canonicalJson((value as Record<string, unknown>)[key]),
      )
      .join(",") +
    "}"
  );
}

/** Compute SHA-256 of canonical JSON string. */
export async function computeCanonicalHash(value: unknown): Promise<string> {
  const text = canonicalJson(value);
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import(/* @vite-ignore */ "node:crypto");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

