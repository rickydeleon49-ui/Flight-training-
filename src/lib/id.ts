/**
 * Application-generated identifiers. Ids are created here, never by SQLite.
 *
 * `crypto.randomUUID` landed in WebKit after Safari 15.0 (bug 229240), so the
 * WebKit on early macOS 12 may lack it. Then a version 4 UUID is built from
 * `crypto.getRandomValues`, which WebKit has had for many years. There is no
 * weaker fallback: without secure randomness, creating an id fails loudly.
 */
export const newId = (): string => {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  if (typeof source?.getRandomValues === "function") {
    return uuidV4FromBytes(source.getRandomValues(new Uint8Array(16)));
  }
  throw new Error("Secure random numbers are unavailable, so a new record id could not be created.");
};

/** Format 16 random bytes as an RFC 9562 version 4 UUID (version and variant bits set). */
export function uuidV4FromBytes(random: Uint8Array): string {
  if (random.length !== 16) throw new Error("A UUID needs exactly 16 random bytes.");
  const bytes = Uint8Array.from(random);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
