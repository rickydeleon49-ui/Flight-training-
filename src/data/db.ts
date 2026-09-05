/**
 * The narrow database surface the rest of the application depends on.
 *
 * Repositories talk to this interface, never to a concrete driver, so the
 * same repository code runs against Tauri's bundled SQLite in the desktop
 * app, sql.js in a plain browser during development, and node:sqlite in
 * tests. Replacing local persistence with a hosted backend means writing
 * one new implementation of this interface.
 */
export interface SqlDatabase {
  /** Run a query and return typed rows. */
  select<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Run a statement that returns no rows. */
  execute(sql: string, params?: SqlValue[]): Promise<void>;
  /** Flush to durable storage where the driver needs it. Optional. */
  persist?(): Promise<void>;
}

export type SqlValue = string | number | null;

/**
 * Rewrite `?` placeholders to the `$1, $2, …` form Tauri's SQL plugin wants.
 *
 * All application queries are written with `?` so they stay portable across
 * the three drivers. Our SQL never contains a literal `?` inside a string,
 * which is what makes this safe.
 */
export function toNumberedPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/* ---------------------------- row helpers ---------------------------- */

/** SQLite has no boolean type; it stores 0/1. */
export const toBool = (value: unknown): boolean => value === 1 || value === true;
export const fromBool = (value: boolean): number => (value ? 1 : 0);

export const toText = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

export const toNullableText = (value: unknown): string | null =>
  value == null || value === "" ? null : String(value);

export const toNullableNumber = (value: unknown): number | null =>
  value == null ? null : Number(value);

/** Narrow a stored string to a known union, falling back when data is old. */
export function toEnum<T extends string>(
  value: unknown,
  allowed: Record<T, unknown>,
  fallback: T,
): T {
  const text = typeof value === "string" ? value : "";
  return Object.prototype.hasOwnProperty.call(allowed, text) ? (text as T) : fallback;
}
