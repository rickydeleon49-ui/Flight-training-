/**
 * Content-addressed card identity (approved default C-D3).
 *
 * For material `m` with ordered cards `C` (only front, back, sourcePage, and
 * `origin` when a card has one — OFFLINE-03):
 *
 *   content_hash = sha256(canonical_json(C))
 *   version_id   = sha256(m + "\u0000" + content_hash)
 *   item_id      = sha256(version_id + "\u0000" + ordinal)
 *
 * The current version is always derived from the saved raw cards, never
 * trusted from storage. Changed text is a new version that starts fresh;
 * identical text maps back to the same version and its retained history.
 * The native twin in `src-tauri/src/card_reviews.rs` reproduces the same
 * golden vectors (`docs/evidence/m2-card-review-scope-2026-10-06/proof/fixtures/identity-golden.json`).
 * A card without `origin` hashes exactly as before, so every legacy snapshot
 * keeps its hash, version id and history.
 */

export const MAX_CARDS = 500;
export const MAX_FRONT_CHARS = 1_000;
export const MAX_BACK_CHARS = 2_000;
export const MAX_SOURCE_PAGE = 1_000;

/** Who wrote a card she made or edited; absent for generated or imported cards. */
export type CardOrigin = "user" | "instructor";

export interface CanonicalCard {
  front: string;
  back: string;
  sourcePage: number | null;
  origin?: CardOrigin;
}

export interface CardItem extends CanonicalCard {
  itemId: string;
  ordinal: number;
}

export interface CardVersion {
  versionId: string;
  contentHash: string;
  items: CardItem[];
}

/** What a material's saved cards are, for review. */
export type SavedCards =
  | { status: "none" }
  | { status: "malformed" }
  | { status: "ok"; cards: CanonicalCard[] };

export type CurrentCards =
  | { status: "none" }
  | { status: "malformed" }
  | ({ status: "ok" } & CardVersion);

/** Sorted-key compact JSON, the canonical form the app already hashes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Lower-case hex SHA-256 of UTF-8 text. */
export async function sha256Hex(text: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import(/* @vite-ignore */ "node:crypto");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Whitespace trimmed before length checks: exactly ECMAScript `trim`. The
 * native twin trims the same set (Unicode White_Space minus U+0085, plus
 * U+FEFF), so both sides agree on every boundary.
 */
export function trimmedCodePoints(text: string): number {
  return Array.from(text.trim()).length;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** A card side is valid when it is well-formed text whose trimmed length is 1–`max` code points. */
export function isValidCardText(value: unknown, max: number): value is string {
  return validText(value, max);
}

function validText(value: unknown, max: number): value is string {
  if (typeof value !== "string" || LONE_SURROGATE.test(value)) return false;
  const length = trimmedCodePoints(value);
  return length >= 1 && length <= max;
}

/**
 * Validate a material's saved `flashcards_json`. An absent row or a valid
 * empty array is `none` (guide-only packets save no cards). A set is
 * reviewable only when every card validates; otherwise the whole set is
 * `malformed`. Nothing is converted to empty.
 */
export function parseSavedCards(flashcardsJson: string | null | undefined): SavedCards {
  if (flashcardsJson === null || flashcardsJson === undefined) return { status: "none" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(flashcardsJson);
  } catch {
    return { status: "malformed" };
  }
  if (!Array.isArray(parsed)) return { status: "malformed" };
  if (parsed.length === 0) return { status: "none" };
  if (parsed.length > MAX_CARDS) return { status: "malformed" };
  const cards: CanonicalCard[] = [];
  for (const card of parsed) {
    if (card === null || typeof card !== "object" || Array.isArray(card)) return { status: "malformed" };
    const { front, back } = card as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(card, "sourcePage")) return { status: "malformed" };
    const sourcePage = (card as Record<string, unknown>).sourcePage;
    if (!validText(front, MAX_FRONT_CHARS) || !validText(back, MAX_BACK_CHARS)) return { status: "malformed" };
    if (
      sourcePage !== null &&
      !(typeof sourcePage === "number" && Number.isInteger(sourcePage) && sourcePage >= 1 && sourcePage <= MAX_SOURCE_PAGE)
    ) {
      return { status: "malformed" };
    }
    let origin: CardOrigin | undefined;
    if (Object.prototype.hasOwnProperty.call(card, "origin")) {
      const value = (card as Record<string, unknown>).origin;
      if (value !== "user" && value !== "instructor") return { status: "malformed" };
      origin = value;
    }
    cards.push({ front, back, sourcePage: sourcePage as number | null, ...(origin ? { origin } : {}) });
  }
  return { status: "ok", cards };
}

/** The content-addressed version of a material's ordered cards. */
export async function cardVersion(materialId: string, cards: readonly CanonicalCard[]): Promise<CardVersion> {
  const canonical = cards.map(({ front, back, sourcePage, origin }) => (origin ? { front, back, sourcePage, origin } : { front, back, sourcePage }));
  const contentHash = await sha256Hex(canonicalJson(canonical));
  const versionId = await sha256Hex(`${materialId}\u0000${contentHash}`);
  const items = await Promise.all(
    canonical.map(async (card, ordinal) => ({
      itemId: await sha256Hex(`${versionId}\u0000${ordinal}`),
      ordinal,
      ...card,
    })),
  );
  return { versionId, contentHash, items };
}

/**
 * A snapshot's own origin (native `version_origin`): `manual` when she wrote
 * every card, `mixed` when she wrote some, `null` when none.
 */
export function versionOrigin(cards: readonly CanonicalCard[]): "manual" | "mixed" | null {
  const mine = cards.filter((card) => card.origin !== undefined).length;
  return mine === 0 ? null : mine === cards.length ? "manual" : "mixed";
}

/** Derive the current version from the saved raw cards. Reads nothing, writes nothing. */
export async function deriveCurrentCards(materialId: string, flashcardsJson: string | null | undefined): Promise<CurrentCards> {
  const saved = parseSavedCards(flashcardsJson);
  if (saved.status !== "ok") return saved;
  return { status: "ok", ...(await cardVersion(materialId, saved.cards)) };
}
