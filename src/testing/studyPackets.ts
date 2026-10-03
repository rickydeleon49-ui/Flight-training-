/**
 * Test support for the structured study-packet validator. Synthetic data only.
 *
 * Ported from the accepted reference runners in
 * docs/evidence/structured-study-import-contract-2026-10-03/
 * (prototype/boundary-cases.mjs.txt and prototype-r5/run-fixtures.mjs.txt).
 * Multi-megabyte and credential-shaped inputs are built at run time so that
 * they are never committed.
 */
import { LIMITS } from "@/logic/studyPacket";
import type { PacketValidationResult } from "@/logic/studyPacket";

export const SENTINEL = "SENTINEL-PRIVATE-7f3a";

export interface ExpectedOutcome {
  ok: boolean;
  stage?: string;
  codes?: string[];
  reported?: number;
  omitted?: number;
  paths?: string[];
  warnings?: string[];
  createsStudySet?: boolean;
  createsPracticeTest?: boolean;
  counts?: Record<string, number>;
  title?: string;
  correctIndexes?: number[];
  noCarriageReturns?: boolean;
  previewSource?: unknown;
  previewRefs?: { cards: unknown[]; questions: unknown[] };
  discardedOnSave?: unknown;
  persistenceExcludes?: string[];
  payloadSourceNotes?: string;
  previewGuideSourceNotes?: string;
  previewGuide?: unknown;
}

const json = (value: unknown) => JSON.stringify(value);

/** Every way an actual result differs from its expectation; empty when it matches. */
export function compareOutcome(actual: PacketValidationResult, expected: ExpectedOutcome): string[] {
  const problems: string[] = [];
  if (actual.ok !== expected.ok) problems.push(`ok=${actual.ok}`);
  if (!actual.ok) {
    if ("preview" in actual || "payload" in actual) problems.push("failure carries preview or payload");
    if (json(actual).includes(SENTINEL)) problems.push("sentinel echoed");
    if (expected.ok) return problems;
    if (expected.stage && actual.stage !== expected.stage) problems.push(`stage=${actual.stage}`);
    const codes = [...new Set(actual.errors.map((e) => e.code))].sort();
    if (json(codes) !== json(expected.codes)) problems.push(`codes=${codes.join(",")}`);
    if (expected.reported !== undefined && actual.errors.length !== expected.reported) problems.push(`reported=${actual.errors.length}`);
    if (expected.omitted !== undefined && actual.omittedErrors !== expected.omitted) problems.push(`omitted=${actual.omittedErrors}`);
    if (expected.paths && json(actual.errors.map((e) => e.path)) !== json(expected.paths)) problems.push("paths");
    return problems;
  }
  const preview = actual.preview;
  const data = preview.data;
  if (expected.warnings) {
    const got = preview.warnings.map((w) => w.code).sort();
    if (json(got) !== json([...expected.warnings].sort())) problems.push(`warnings=${got.join(",")}`);
  }
  if (expected.createsStudySet !== undefined && preview.createsStudySet !== expected.createsStudySet) problems.push("createsStudySet");
  if (expected.createsPracticeTest !== undefined && preview.createsPracticeTest !== expected.createsPracticeTest) problems.push("createsPracticeTest");
  if (expected.counts && json(preview.counts) !== json(expected.counts)) problems.push(`counts=${json(preview.counts)}`);
  if (expected.title && preview.title !== expected.title) problems.push("title");
  if (expected.correctIndexes) {
    const got = actual.payload.practiceTest?.questions.map((q) => q.correctIndex);
    if (json(got) !== json(expected.correctIndexes)) problems.push(`correctIndexes=${json(got)}`);
  }
  if (expected.noCarriageReturns && json(actual.payload).includes("\\r")) problems.push("carriage return kept");
  const pages = [
    ...(actual.payload.studySet?.flashcards ?? []).map((c) => c.sourcePage),
    ...(actual.payload.practiceTest?.questions ?? []).map((q) => q.sourcePage),
  ];
  if (pages.some((page) => page !== null)) problems.push("sourcePage not null");
  if ("previewSource" in expected && json(data.source) !== json(expected.previewSource)) problems.push("preview source");
  if (expected.previewRefs) {
    const got = { cards: data.flashcards.map((c) => [c.id, c.sourceRefs]), questions: data.questions.map((q) => [q.id, q.sourceRefs]) };
    if (json(got) !== json(expected.previewRefs)) problems.push("preview refs");
  }
  if (expected.discardedOnSave && json(preview.discardedOnSave) !== json(expected.discardedOnSave)) problems.push("discardedOnSave");
  for (const value of expected.persistenceExcludes ?? []) if (json(actual.payload).includes(value)) problems.push("preview-only value in payload");
  if ("payloadSourceNotes" in expected && actual.payload.studySet?.sourceNotes !== expected.payloadSourceNotes) problems.push("payload sourceNotes");
  if ("previewGuideSourceNotes" in expected && data.guide?.sourceNotes !== expected.previewGuideSourceNotes) problems.push("preview sourceNotes");
  if ("previewGuide" in expected && json(data.guide) !== json(expected.previewGuide)) problems.push("preview guide");
  return problems;
}

// ---------------------------------------------------------------- generated boundary cases
const encode = (text: string) => new TextEncoder().encode(text);
const base = (extra: Record<string, unknown> = {}) => ({ format: "hfd-study-packet", formatVersion: 1, title: "Boundary", ...extra });
const guide = { summary: "x" };
const question = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `q${i}`, type: "single-choice", question: `Pick label ${i}`,
  choices: [{ id: "a", text: "Zorb" }, { id: "b", text: "Quill" }], correctChoiceId: "b",
  explanation: "Invented.", ...extra,
});
const card = (i: number, extra: Record<string, unknown> = {}) => ({ id: `c${i}`, front: `Front ${i}`, back: `Back ${i}`, ...extra });
const packet = (value: unknown) => encode(JSON.stringify(value));
const ok = (extra: Partial<ExpectedOutcome> = {}): ExpectedOutcome => ({ ok: true, ...extra });
const no = (stage: string, ...codes: string[]): ExpectedOutcome => ({ ok: false, stage, codes: [...new Set(codes)].sort() });

function countValues(value: unknown): number {
  if (Array.isArray(value)) return 1 + value.reduce((n: number, item) => n + countValues(item), 0);
  if (value && typeof value === "object") return 1 + Object.values(value).reduce((n: number, item) => n + countValues(item), 0);
  return 1;
}
function padTo(bytes: Uint8Array, target: number): Uint8Array {
  const out = new Uint8Array(target);
  out.set(bytes);
  out.fill(0x20, bytes.length);
  return out;
}
function nestArrays(levels: number): unknown {
  let value: unknown = 0;
  for (let k = 0; k < levels; k++) value = [value];
  return value;
}
function nestObjects(levels: number): unknown {
  let value: unknown = 0;
  for (let k = 0; k < levels; k++) value = { a: value };
  return value;
}

export interface BoundaryCase {
  name: string;
  bytes: Uint8Array;
  expected: ExpectedOutcome;
}

/** The 49 generated cases of the accepted reference, with their expectations. */
export function boundaryCases(): BoundaryCase[] {
  const cases: BoundaryCase[] = [];
  const add = (name: string, bytes: Uint8Array, expected: ExpectedOutcome) => cases.push({ name, bytes, expected });

  add("empty-file", new Uint8Array(0), no("bytes", "file_empty"));
  add("utf16le-bom", new Uint8Array([0xff, 0xfe, 0x7b, 0x00, 0x7d, 0x00]), no("bytes", "unsupported_encoding"));
  add("invalid-utf8-sequence", new Uint8Array([...encode('{"title":"'), 0xc3, 0x28, ...encode('"}')]), no("bytes", "invalid_utf8"));
  add("overlong-utf8", new Uint8Array([...encode('{"title":"'), 0xc0, 0xaf, ...encode('"}')]), no("bytes", "invalid_utf8"));
  add("utf8-bom-accepted", new Uint8Array([0xef, 0xbb, 0xbf, ...packet(base({ guide }))]), ok({ warnings: ["no_practice_test", "utf8_bom_removed"] }));

  const small = packet(base({ guide }));
  add("file-bytes-limit-minus-1", padTo(small, LIMITS.fileBytes - 1), ok());
  add("file-bytes-at-limit", padTo(small, LIMITS.fileBytes), ok());
  add("file-bytes-limit-plus-1", padTo(small, LIMITS.fileBytes + 1), no("bytes", "file_too_large"));

  add("depth-at-limit-8", packet(base({ guide, x: nestArrays(LIMITS.depth - 1) })), no("schema", "unknown_field"));
  add("depth-over-limit-9", packet(base({ guide, x: nestArrays(LIMITS.depth) })), no("scan", "depth_exceeded"));
  add("depth-at-limit-8-objects", packet(base({ guide, x: nestObjects(LIMITS.depth - 1) })), no("schema", "unknown_field"));
  add("depth-over-limit-9-objects", packet(base({ guide, x: nestObjects(LIMITS.depth) })), no("scan", "depth_exceeded"));

  const keys = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, k) => [`k${k}`, 0]));
  add("object-keys-at-limit-32", packet({ ...base({ guide }), ...keys(LIMITS.objectKeys - 4) }), no("schema", "unknown_field"));
  add("object-keys-over-limit-33", packet({ ...base({ guide }), ...keys(LIMITS.objectKeys - 3) }), no("scan", "too_many_keys"));
  add("key-length-at-limit-64", packet(base({ guide, ["k".repeat(64)]: 0 })), no("schema", "unknown_field"));
  add("key-length-over-limit-65", packet(base({ guide, ["k".repeat(65)]: 0 })), no("scan", "key_too_long"));

  add("integer-9-digits", packet(base({ flashcards: [card(1, { sourceRefs: [{ page: 123456789 }] })] })), no("schema", "page_out_of_range"));
  add("integer-10-digits", packet(base({ flashcards: [card(1, { sourceRefs: [{ page: 1234567890 }] })] })), no("scan", "unsupported_number"));
  add("page-at-max-1000", packet(base({ flashcards: [card(1, { sourceRefs: [{ page: 1000 }] })] })), ok({ warnings: ["no_practice_test", "source_refs_unverified"] }));

  const room = LIMITS.values - countValues(base({ guide, x: [] }));
  add("values-at-limit", packet(base({ guide, x: new Array(room).fill(0) })), no("schema", "unknown_field"));
  add("values-over-limit", packet(base({ guide, x: new Array(room + 1).fill(0) })), no("scan", "too_many_values"));

  add("title-199-code-points", packet(base({ guide, title: "\u{1F680}".repeat(199) })), ok());
  add("title-200-code-points-astral", packet(base({ guide, title: "\u{1F680}".repeat(200) })), ok());
  add("title-201-code-points", packet(base({ guide, title: "\u{1F680}".repeat(201) })), no("schema", "too_long"));
  add("title-nfc-200-after-normalization", packet(base({ guide, title: "é".repeat(200) })), ok());
  add("body-20000", packet(base({ guide: { sections: [{ heading: "h", body: "b".repeat(20_000) }] } })), ok());
  add("body-20001", packet(base({ guide: { sections: [{ heading: "h", body: "b".repeat(20_001) }] } })), no("schema", "too_long"));

  const choices = (n: number) => Array.from({ length: n }, (_, k) => ({ id: `c${k}`, text: `Label ${k}` }));
  add("choices-6", packet(base({ questions: [question(1, { choices: choices(6), correctChoiceId: "c0" })] })), ok());
  add("choices-7", packet(base({ questions: [question(1, { choices: choices(7), correctChoiceId: "c0" })] })), no("schema", "too_many_items"));
  add("choices-2", packet(base({ questions: [question(1)] })), ok());
  add("questions-200", packet(base({ questions: Array.from({ length: 200 }, (_, k) => question(k)) })), ok());
  add("questions-201", packet(base({ questions: Array.from({ length: 201 }, (_, k) => question(k)) })), no("schema", "too_many_items"));
  add("flashcards-500", packet(base({ flashcards: Array.from({ length: 500 }, (_, k) => card(k)) })), ok());
  add("flashcards-501", packet(base({ flashcards: Array.from({ length: 501 }, (_, k) => card(k)) })), no("schema", "too_many_items"));
  const sections = (n: number) => Array.from({ length: n }, (_, k) => ({ heading: `H${k}`, body: "b" }));
  add("sections-100", packet(base({ guide: { sections: sections(100) } })), ok());
  add("sections-101", packet(base({ guide: { sections: sections(101) } })), no("schema", "too_many_items"));
  const refs = (n: number) => Array.from({ length: n }, (_, k) => ({ label: `Ref ${k}` }));
  add("source-refs-5", packet(base({ flashcards: [card(1, { sourceRefs: refs(5) })] })), ok());
  add("source-refs-6", packet(base({ flashcards: [card(1, { sourceRefs: refs(6) })] })), no("schema", "too_many_items"));

  add("id-64", packet(base({ flashcards: [card(1, { id: "a".repeat(64) })] })), ok());
  add("id-65", packet(base({ flashcards: [card(1, { id: "a".repeat(65) })] })), no("schema", "invalid_id"));
  add("choice-id-32", packet(base({ questions: [question(1, { choices: [{ id: "x".repeat(32), text: "A" }, { id: "b", text: "B" }], correctChoiceId: "b" })] })), ok());
  add("choice-id-33", packet(base({ questions: [question(1, { choices: [{ id: "x".repeat(33), text: "A" }, { id: "b", text: "B" }], correctChoiceId: "b" })] })), no("schema", "invalid_id"));

  const googleLike = "AIza" + "B".repeat(35);
  const pemLike = "-----BEGIN " + "PRIVATE KEY-----";
  add("credential-google-key-shape", packet(base({ guide: { summary: `Key: ${googleLike} ${SENTINEL}` } })), no("semantic", "credential_like_content"));
  add("credential-pem-header", packet(base({ flashcards: [card(1, { back: `${pemLike}\nabc` })] })), no("semantic", "credential_like_content"));

  add("error-cap-60", packet(base({ questions: Array.from({ length: 60 }, (_, k) => question(k, { correctChoiceId: "z" })) })), {
    ...no("semantic", "answer_key_not_in_choices"), reported: 50, omitted: 10,
  });

  add("sentinel-wrong-type", packet(base({ guide: { summary: SENTINEL, sections: SENTINEL } })), no("schema", "wrong_type"));
  add("sentinel-bad-answer", packet(base({ questions: [question(1, { question: SENTINEL, correctChoiceId: "zz" })] })), no("semantic", "answer_key_not_in_choices"));
  add("sentinel-unknown-field-name", packet(base({ guide, [`${SENTINEL} with spaces`]: SENTINEL })), no("schema", "unknown_field"));
  add(
    "sentinel-duplicate-key-unsafe-name",
    encode(`{"format":"hfd-study-packet","formatVersion":1,"title":"x","guide":{"summary":"x"},"${SENTINEL} !":1,"${SENTINEL} !":2}`),
    no("scan", "duplicate_key"),
  );
  return cases;
}
