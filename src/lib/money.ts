/**
 * Money helpers. Amounts are whole cents everywhere in the application;
 * dollars only exist at the edges, for display and for form input.
 */
import type { Cents } from "@/domain/types";

/** e.g. 275000 -> "$2,750.00", or "$2,750" when the cents are zero. */
export function formatMoney(cents: Cents, options: { showCents?: boolean } = {}): string {
  const showCents = options.showCents ?? cents % 100 !== 0;
  const value = cents / 100;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
}

/** Compact form for dense rows, e.g. "~$275". */
export const formatApproxMoney = (cents: Cents): string =>
  `~${formatMoney(Math.round(cents / 100) * 100, { showCents: false })}`;

/**
 * Parse user input into cents. Accepts "275", "$275.50", "1,200".
 * Returns null when the text is not a usable amount, so forms can explain
 * the problem rather than silently storing a zero.
 */
export function parseMoney(input: string): Cents | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (Number.isNaN(value)) return null;
  return Math.round(value * 100);
}

/** Cents back into an editable field value, e.g. 27550 -> "275.50". */
export const moneyToInput = (cents: Cents | null): string =>
  cents == null ? "" : (cents / 100).toFixed(2);
