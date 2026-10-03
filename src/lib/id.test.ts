import { afterEach, describe, expect, it, vi } from "vitest";

import { createRepositories } from "@/data/repositories";
import { createNodeSqliteDatabase } from "@/data/testing/nodeSqliteDb";
import { removeCapabilities, removeCapability } from "@/testing/capabilities";

import { newId, uuidV4FromBytes } from "./id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
  vi.restoreAllMocks();
});

describe("newId on a modern engine", () => {
  it("uses crypto.randomUUID when it exists", () => {
    const native = vi.spyOn(globalThis.crypto, "randomUUID");
    const fallback = vi.spyOn(globalThis.crypto, "getRandomValues");
    const id = newId();
    expect(native).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    expect(id).toMatch(UUID_V4);
  });
});

describe("newId without crypto.randomUUID (WebKit before Safari 15.4)", () => {
  it("builds a version 4 UUID from crypto.getRandomValues", () => {
    restore = removeCapability(globalThis.crypto, "randomUUID");
    expect(typeof globalThis.crypto.randomUUID).toBe("undefined");
    const secure = vi.spyOn(globalThis.crypto, "getRandomValues");
    const insecure = vi.spyOn(Math, "random");
    const ids = Array.from({ length: 2_000 }, () => newId());
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(ids.length);
    expect(secure).toHaveBeenCalledTimes(ids.length);
    expect(insecure).not.toHaveBeenCalled();
  });

  it("formats injected random bytes exactly, pinning version and variant bits", () => {
    restore = removeCapability(globalThis.crypto, "randomUUID");
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint8Array).fill(0xff);
      return array;
    });
    expect(newId()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("refuses to create an id when secure randomness is unavailable, rather than weakening it", () => {
    restore = removeCapabilities([[globalThis.crypto, "randomUUID"], [globalThis.crypto, "getRandomValues"]]);
    const insecure = vi.spyOn(Math, "random");
    const clock = vi.spyOn(Date, "now");
    expect(() => newId()).toThrow(/Secure random numbers are unavailable/);
    expect(insecure).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });

  it("gives repository records valid, distinct ids through the fallback", async () => {
    restore = removeCapability(globalThis.crypto, "randomUUID");
    const db = await createNodeSqliteDatabase();
    try {
      const repos = createRepositories(db);
      const created = await Promise.all(
        Array.from({ length: 25 }, (_, index) => repos.documents.create({ title: `Synthetic ${index}`, tags: [`tag-${index}`] })),
      );
      const listed = await repos.documents.list();
      expect(listed).toHaveLength(25);
      expect(new Set(listed.map((m) => m.id))).toEqual(new Set(created.map((m) => m.id)));
      for (const material of listed) expect(material.id).toMatch(UUID_V4);
    } finally {
      db.close();
    }
  });
});

describe("uuidV4FromBytes", () => {
  it("sets the version nibble to 4 and the variant to 10xx without touching other bits", () => {
    expect(uuidV4FromBytes(new Uint8Array(16))).toBe("00000000-0000-4000-8000-000000000000");
    const ascending = Uint8Array.from({ length: 16 }, (_, i) => i);
    expect(uuidV4FromBytes(ascending)).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    const pattern = Uint8Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 0xff);
    const id = uuidV4FromBytes(pattern);
    expect(id).toMatch(UUID_V4);
    // Every byte other than 6 and 8 is copied verbatim; those keep their low bits.
    const bytes = id.replace(/-/g, "").match(/../g)!.map((pair) => parseInt(pair, 16));
    bytes.forEach((byte, index) => {
      if (index === 6) expect(byte).toBe((pattern[6]! & 0x0f) | 0x40);
      else if (index === 8) expect(byte).toBe((pattern[8]! & 0x3f) | 0x80);
      else expect(byte).toBe(pattern[index]);
    });
  });

  it("does not modify the caller's bytes and rejects the wrong length", () => {
    const input = new Uint8Array(16).fill(0xff);
    uuidV4FromBytes(input);
    expect(Array.from(input)).toEqual(new Array(16).fill(0xff));
    expect(() => uuidV4FromBytes(new Uint8Array(15))).toThrow(/exactly 16/);
  });
});
