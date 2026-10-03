/**
 * Byte decoding and the strict bounded JSON scanner (contract §2.11).
 *
 * `JSON.parse` is never used: it keeps the last of two duplicate keys,
 * accepts `1.0`, decodes `\u0000` and lone surrogates, and assigning a parsed
 * `__proto__` can change an object's prototype. This scanner builds the value
 * itself in one pass, stops at the first problem, and is bounded by depth,
 * keys per object and total values.
 */
import { CONTRACT_FIELDS, FORBIDDEN_KEYS, LIMITS } from "./limits";
import { pathFromParts, rawError, type RawError } from "./diagnostics";
import type { PacketErrorCode, PacketWarningCode } from "./types";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function codePointLength(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    count++;
  }
  return count;
}

/**
 * C0/C1 controls (except tab, LF and CR), DEL and lone surrogates. A loop,
 * because `String.prototype.isWellFormed` and regex lookbehind are missing
 * from macOS 12.0 WebKit.
 */
export function hasInvalidCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      return true;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
    if (unit === 0x09 || unit === 0x0a || unit === 0x0d) continue;
    if (unit < 0x20 || (unit >= 0x7f && unit <= 0x9f)) return true;
  }
  return false;
}

export type DecodeResult =
  | { ok: true; text: string; warnings: PacketWarningCode[] }
  | { ok: false; error: RawError };

/** Original bytes to text: size, UTF-16 byte-order marks, strict UTF-8, one UTF-8 BOM removed. */
export function decodeBytes(bytes: Uint8Array): DecodeResult {
  if (bytes.length === 0) return { ok: false, error: rawError("file_empty", "$") };
  if (bytes.length > LIMITS.fileBytes) {
    return { ok: false, error: rawError("file_too_large", "$", { limit: LIMITS.fileBytes }) };
  }
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe)) {
    return { ok: false, error: rawError("unsupported_encoding", "$") };
  }
  const warnings: PacketWarningCode[] = [];
  let view = bytes;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    view = bytes.subarray(3);
    warnings.push("utf8_bom_removed");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(view);
  } catch {
    return { ok: false, error: rawError("invalid_utf8", "$") };
  }
  if (text.length === 0) return { ok: false, error: rawError("file_empty", "$") };
  return { ok: true, text, warnings };
}

class ScanStop extends Error {
  constructor(readonly issue: RawError) {
    super(issue.code);
  }
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
};
const NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/;
const HEX4 = /^[0-9A-Fa-f]{4}$/;

export type ScanResult = { ok: true; value: JsonValue } | { ok: false; error: RawError };

/** Strict RFC 8259 grammar with the contract's bounds. */
export function scanJson(text: string): ScanResult {
  let i = 0;
  let values = 0;
  const path: (string | number)[] = [];

  const stop = (code: PacketErrorCode, extra: Omit<RawError, "code" | "path"> = {}): never => {
    throw new ScanStop(rawError(code, pathFromParts(path), { offset: i, ...extra }));
  };
  const skipWhitespace = () => {
    while (i < text.length) {
      const unit = text.charCodeAt(i);
      if (unit === 0x20 || unit === 0x09 || unit === 0x0a || unit === 0x0d) i++;
      else break;
    }
  };

  const parseString = (): string => {
    i++; // opening quote
    let out = "";
    let start = i;
    for (;;) {
      if (i >= text.length) stop("malformed_json");
      const unit = text.charCodeAt(i);
      if (unit === 0x22) {
        out += text.slice(start, i);
        i++;
        break;
      }
      if (unit < 0x20) stop("malformed_json"); // raw control characters are not JSON
      if (unit === 0x5c) {
        out += text.slice(start, i);
        const escape = text.charAt(i + 1);
        const simple = Object.prototype.hasOwnProperty.call(SIMPLE_ESCAPES, escape) ? SIMPLE_ESCAPES[escape] : undefined;
        if (simple !== undefined) {
          out += simple;
          i += 2;
        } else if (escape === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!HEX4.test(hex)) stop("malformed_json");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else {
          stop("malformed_json");
        }
        start = i;
        continue;
      }
      i++;
    }
    if (hasInvalidCharacters(out)) stop("invalid_string_character");
    return out;
  };

  const parseNumber = (): number => {
    const match = NUMBER.exec(text.slice(i, i + 64));
    if (!match) return stop("malformed_json");
    if (match[2] || match[3] || (match[1] ?? "").length > LIMITS.integerDigits) stop("unsupported_number");
    i += match[0].length;
    return Number(match[0]);
  };

  const parseValue = (depth: number): JsonValue => {
    skipWhitespace();
    if (i >= text.length) stop("malformed_json");
    if (++values > LIMITS.values) stop("too_many_values");
    const ch = text.charAt(i);
    if (ch === "{") {
      if (depth + 1 > LIMITS.depth) stop("depth_exceeded", { limit: LIMITS.depth });
      i++;
      const object: { [key: string]: JsonValue } = {};
      const seen = new Set<string>();
      skipWhitespace();
      if (text.charAt(i) === "}") {
        i++;
        return object;
      }
      for (;;) {
        skipWhitespace();
        if (text.charAt(i) !== '"') stop("malformed_json");
        const key = parseString();
        if (FORBIDDEN_KEYS.has(key)) stop("forbidden_property_name");
        if (codePointLength(key) > LIMITS.keyCodePoints) stop("key_too_long", { limit: LIMITS.keyCodePoints });
        if (seen.has(key)) stop("duplicate_key", CONTRACT_FIELDS.has(key) ? { field: key } : {});
        seen.add(key);
        if (seen.size > LIMITS.objectKeys) stop("too_many_keys", { limit: LIMITS.objectKeys });
        skipWhitespace();
        if (text.charAt(i) !== ":") stop("malformed_json");
        i++;
        path.push(key);
        object[key] = parseValue(depth + 1);
        path.pop();
        skipWhitespace();
        if (text.charAt(i) === ",") {
          i++;
          continue;
        }
        if (text.charAt(i) === "}") {
          i++;
          return object;
        }
        stop("malformed_json");
      }
    }
    if (ch === "[") {
      if (depth + 1 > LIMITS.depth) stop("depth_exceeded", { limit: LIMITS.depth });
      i++;
      const array: JsonValue[] = [];
      skipWhitespace();
      if (text.charAt(i) === "]") {
        i++;
        return array;
      }
      for (;;) {
        path.push(array.length);
        array.push(parseValue(depth + 1));
        path.pop();
        skipWhitespace();
        if (text.charAt(i) === ",") {
          i++;
          continue;
        }
        if (text.charAt(i) === "]") {
          i++;
          return array;
        }
        stop("malformed_json");
      }
    }
    if (ch === '"') return parseString();
    if (ch === "-" || (ch >= "0" && ch <= "9")) return parseNumber();
    if (text.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (text.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (text.startsWith("null", i)) {
      i += 4;
      return null;
    }
    return stop("malformed_json");
  };

  try {
    const value = parseValue(0);
    skipWhitespace();
    if (i !== text.length) stop("trailing_content");
    return { ok: true, value };
  } catch (error) {
    if (error instanceof ScanStop) return { ok: false, error: error.issue };
    throw error;
  }
}
