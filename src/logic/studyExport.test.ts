import { describe, expect, it } from "vitest";

import type { AiStudySet, PracticeTest } from "@/domain/types";
import { canonicalPersistenceJson, validatePacketText } from "@/logic/studyPacket";
import { makeMaterial } from "@/testing/factories";

import { EXPORT_MESSAGES, exportSourceFor, hasHandwrittenItems, hasInstructorCorrections, provenanceNote, exportFileName, exportStudyPacket, exportableParts, type ExportSource } from "./studyExport";

const NOW = new Date("2026-10-16T18:00:00Z");
const ALL = { guide: true, flashcards: true, questions: true };

function studySet(overrides: Partial<AiStudySet> = {}): AiStudySet {
  return {
    sourceMaterialId: "material-1",
    title: "Weather guide",
    summary: "How METARs and TAFs describe the weather.",
    sections: [
      { heading: "Reading a METAR", body: "- Station\n- Time\n- **Wind** first\n\n| Code | Meaning |\n| --- | --- |\n| BKN | Broken |" },
      { heading: "Ceilings", body: "The lowest broken or overcast layer." },
    ],
    flashcards: [
      { front: "What is a METAR?", back: "A routine surface weather observation.", sourcePage: 12 },
      { front: "BKN means?", back: "Broken: 5/8 to 7/8 sky cover.", sourcePage: null },
    ],
    sourceNotes: "Based on the Aviation Weather Handbook, chapter 24.",
    provider: "gemini",
    model: "gemini-3.5-flash",
    generatedAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

function practiceTest(overrides: Partial<PracticeTest> = {}): PracticeTest {
  return {
    sourceMaterialId: "material-1",
    title: "Weather practice",
    questions: [
      {
        question: "Which layer is a ceiling?",
        options: ["Few", "Scattered", "Broken", "Clear"],
        correctIndex: 2,
        explanation: "Broken and overcast layers are ceilings.",
        sourcePage: 14,
      },
      { question: "A TAF is a…", options: ["Forecast", "Observation"], correctIndex: 0, explanation: "Terminal Aerodrome Forecast.", sourcePage: null },
    ],
    provider: "gemini",
    model: "gemini-3.5-flash",
    generatedAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

function source(overrides: Partial<ExportSource> = {}): ExportSource {
  return {
    material: makeMaterial({ id: "material-1", title: "Aviation Weather Handbook", filePath: "documents/private/weather.pdf", notes: "PRIVATE NOTE" }),
    studySet: studySet(),
    practiceTest: practiceTest(),
    ...overrides,
  };
}

function exported(input: ExportSource = source(), selection = ALL) {
  const result = exportStudyPacket(input, selection, NOW);
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe("a study packet export", () => {
  it("passes the import's own validator", () => {
    const result = exported();
    const validation = validatePacketText(result.text);
    expect(validation.ok).toBe(true);
    expect(result.counts).toEqual({ sections: 2, flashcards: 2, questions: 2 });
    expect(result.fileName).toBe("Aviation Weather Handbook.json");
  });

  it("imports exactly the content she chose, answers included", () => {
    const validation = validatePacketText(exported().text);
    if (!validation.ok) throw new Error("invalid");
    const set = studySet();
    const test = practiceTest();
    expect(validation.payload).toEqual({
      material: { title: "Aviation Weather Handbook" },
      studySet: {
        title: "Aviation Weather Handbook",
        summary: set.summary,
        sections: set.sections,
        flashcards: set.flashcards.map((card) => ({ front: card.front, back: card.back, sourcePage: null })),
        sourceNotes: set.sourceNotes,
        provider: "import",
        model: "",
      },
      practiceTest: {
        title: "Aviation Weather Handbook",
        questions: test.questions.map((q) => ({ ...q, sourcePage: null })),
        provider: "import",
        model: "",
      },
    });
  });

  it("is stable: the same content gives the same import content hash", () => {
    const later = exportStudyPacket(source(), ALL, new Date("2027-01-01T00:00:00Z"));
    if (!later.ok) throw new Error(later.message);
    const first = validatePacketText(exported().text);
    const second = validatePacketText(later.text);
    if (!first.ok || !second.ok) throw new Error("invalid");
    // Only the export date differs; what an import saves is identical.
    expect(later.text).not.toBe(exported().text);
    expect(canonicalPersistenceJson(first.payload)).toBe(canonicalPersistenceJson(second.payload));
  });

  it("maps each answer to its own choice", () => {
    const packet = JSON.parse(exported().text) as { questions: { choices: { id: string; text: string }[]; correctChoiceId: string }[] };
    expect(packet.questions.map((q) => q.choices.find((c) => c.id === q.correctChoiceId)?.text)).toEqual(["Broken", "Forecast"]);
  });

  it("includes only the parts she chose", () => {
    const cardsOnly = validatePacketText(exported(source(), { guide: false, flashcards: true, questions: false }).text);
    if (!cardsOnly.ok) throw new Error("invalid");
    expect(cardsOnly.payload.practiceTest).toBeNull();
    expect(cardsOnly.payload.studySet?.sections).toEqual([]);
    expect(cardsOnly.payload.studySet?.summary).toBe("");
    expect(cardsOnly.payload.studySet?.sourceNotes).toBe("");
    expect(cardsOnly.payload.studySet?.flashcards).toHaveLength(2);

    const testOnly = validatePacketText(exported(source(), { guide: false, flashcards: false, questions: true }).text);
    if (!testOnly.ok) throw new Error("invalid");
    expect(testOnly.payload.studySet).toBeNull();
    expect(testOnly.payload.practiceTest?.questions).toHaveLength(2);
  });

  it("refuses an empty choice, including parts the material doesn't have", () => {
    expect(exportStudyPacket(source(), { guide: false, flashcards: false, questions: false }, NOW)).toEqual({
      ok: false,
      message: EXPORT_MESSAGES.nothingChosen,
    });
    expect(exportStudyPacket(source({ practiceTest: null }), { guide: false, flashcards: false, questions: true }, NOW)).toEqual({
      ok: false,
      message: EXPORT_MESSAGES.nothingChosen,
    });
  });

  it("writes nothing but the chosen study content", () => {
    const text = exported().text;
    const packet = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(packet).sort()).toEqual(["flashcards", "format", "formatVersion", "guide", "questions", "source", "title"]);
    for (const absent of ["material-1", "weather.pdf", "documents/", "PRIVATE NOTE", "generatedAt", "2026-10-01"]) {
      expect(text).not.toContain(absent);
    }
  });

  it("says where the content came from", () => {
    const packet = JSON.parse(exported().text) as { source: { generator: string; createdAt: string; note: string } };
    expect(packet.source.generator).toBe("Her Flight Deck");
    expect(packet.source.createdAt).toBe("2026-10-16");
    expect(packet.source.note).toBe(
      "AI-generated study aid (gemini-3.5-flash). Verify everything against current FAA material, aircraft documents and an instructor.",
    );
    expect(packet.source.note).toContain("Verify everything");

    const imported = exported(source({ studySet: studySet({ provider: "import", model: "" }), practiceTest: null }));
    expect((JSON.parse(imported.text) as { source: { note: string } }).source.note).toContain("Imported into Her Flight Deck from a study packet; not checked by the app.");

    const mixed = exported(source({ practiceTest: practiceTest({ provider: "import", model: "" }) }));
    const note = (JSON.parse(mixed.text) as { source: { note: string } }).source.note;
    expect(note).toContain("Study guide and flashcards: AI-generated study aid (gemini-3.5-flash).");
    expect(note).toContain("Practice test: imported into Her Flight Deck");
  });

  it("carries known pages as unverified references, which an import discards", () => {
    const validation = validatePacketText(exported().text);
    if (!validation.ok) throw new Error("invalid");
    expect(validation.preview.data.flashcards[0]?.sourceRefs).toEqual([{ label: "Aviation Weather Handbook", page: 12 }]);
    expect(validation.preview.data.flashcards[1]?.sourceRefs).toEqual([]);
    expect(validation.preview.warnings.map((w) => w.code)).toContain("source_refs_unverified");
  });

  it("refuses content that looks like a credential", () => {
    const leaked = source({ studySet: studySet({ summary: `Key: AIza${"A".repeat(35)}` }) });
    expect(exportStudyPacket(leaked, ALL, NOW)).toEqual({ ok: false, message: EXPORT_MESSAGES.credential });
  });

  it("refuses more than the format can hold", () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ front: `Q${i}`, back: `A${i}`, sourcePage: null }));
    expect(exportStudyPacket(source({ studySet: studySet({ flashcards: many }) }), ALL, NOW)).toEqual({ ok: false, message: EXPORT_MESSAGES.tooLarge });
  });

  it("explains other content the format cannot hold", () => {
    const duplicate = practiceTest({
      questions: [{ question: "Pick", options: ["Same", "Same"], correctIndex: 0, explanation: "x", sourcePage: null }],
    });
    const result = exportStudyPacket(source({ practiceTest: duplicate }), ALL, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.startsWith(EXPORT_MESSAGES.invalid)).toBe(true);
  });

  it("accepts content the format only tidies (line endings and spacing)", () => {
    const messy = source({
      studySet: studySet({ summary: "Line one\r\nLine two   \n" }),
      practiceTest: practiceTest({
        questions: [{ question: "Q?", options: ["  Spaced   out ", "Other"], correctIndex: 0, explanation: "E", sourcePage: null }],
      }),
    });
    const validation = validatePacketText(exported(messy).text);
    if (!validation.ok) throw new Error("invalid");
    expect(validation.payload.studySet?.summary).toBe("Line one\nLine two");
    expect(validation.payload.practiceTest?.questions[0]?.options[0]).toBe("Spaced out");
  });
});

describe("export helpers", () => {
  it("knows which parts a material has", () => {
    expect(exportableParts(source())).toEqual(ALL);
    expect(exportableParts(source({ studySet: studySet({ summary: "", sections: [], flashcards: [] }), practiceTest: null }))).toEqual({
      guide: false,
      flashcards: false,
      questions: false,
    });
  });

  it("suggests a plain file name", () => {
    expect(exportFileName("Weather / Ch. 12: METARs?", "json")).toBe("Weather Ch. 12 METARs.json");
    expect(exportFileName("..hidden", "html")).toBe("hidden.html");
    expect(exportFileName("   ", "json")).toBe("Study packet.json");
  });
});

describe("her own items and her instructor's corrections (OFFLINE-03a)", () => {
  const mixed = () =>
    studySet({
      summaryOrigin: "instructor",
      sections: [
        { heading: "Reading a METAR", body: "Station, time, wind.", itemId: "s-1" },
        { heading: "My mnemonic", body: "Wind before weather.", itemId: "s-2", origin: "user" },
      ],
      flashcards: [
        { front: "What is a METAR?", back: "A routine observation.", sourcePage: 12, itemId: "c-1" },
        { front: "BKN means?", back: "Broken, per my CFI.", sourcePage: null, itemId: "c-2", origin: "instructor", replaces: "c-0" },
      ],
    });
  const source = (set: AiStudySet): ExportSource => ({ material: makeMaterial({ title: "Weather" }), studySet: set, practiceTest: null });

  it("leaves instructor corrections out unless she includes them", () => {
    const left = exportStudyPacket(source(mixed()), ALL, NOW);
    if (!left.ok) throw new Error(left.message);
    expect(left.text).not.toContain("per my CFI");
    expect(left.text).not.toContain("How METARs and TAFs");
    expect(left.counts).toMatchObject({ sections: 2, flashcards: 1 });
    const included = exportStudyPacket(source(mixed()), { ...ALL, instructorCorrections: true }, NOW);
    if (!included.ok) throw new Error(included.message);
    expect(included.text).toContain("per my CFI");
    expect(included.counts.flashcards).toBe(2);
  });

  it("writes a strict v1 packet: no ids, origins or replacements travel, and the note says some was handwritten", () => {
    const result = exportStudyPacket(source(mixed()), { ...ALL, instructorCorrections: true }, NOW);
    if (!result.ok) throw new Error(result.message);
    for (const key of ["itemId", "origin", "replaces", "summaryOrigin"]) expect(result.text).not.toContain(`"${key}"`);
    expect(validatePacketText(result.text).ok).toBe(true);
    expect(result.text).toContain("Some items were written or corrected by hand in Her Flight Deck, not generated.");
  });

  it("never calls a set she wrote AI-generated", () => {
    const result = exportStudyPacket(source(studySet({ provider: "manual", model: "", summaryOrigin: "user" })), ALL, NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.text).toContain("Written by hand in Her Flight Deck; not checked by the app.");
    expect(result.text).not.toContain("AI-generated");
  });

  it("a part holding only instructor corrections has nothing to export until she includes them", () => {
    const onlyCorrection = studySet({ summary: "", sections: [], flashcards: [{ front: "Q", back: "A", sourcePage: null, itemId: "c", origin: "instructor" }] });
    expect(exportStudyPacket(source(onlyCorrection), ALL, NOW)).toEqual({ ok: false, message: EXPORT_MESSAGES.nothingChosen });
    expect(exportStudyPacket(source(onlyCorrection), { ...ALL, instructorCorrections: true }, NOW).ok).toBe(true);
  });
});


describe("the packet note says which items came from a PDF", () => {
  const validPdf = () => ({ status: "valid" as const, label: "Pulled from your PDF on this Mac" as const, sources: [] });

  /** Some of the set came from Gemini, some from the PDF kit. */
  const mixedKit = () =>
    studySet({
      summary: "How METARs and TAFs describe the weather.",
      sections: [
        { heading: "Reading a METAR", body: "- Station\n- Time\n- **Wind** first" },
        { heading: "Ceilings", body: "The lowest broken or overcast layer.", pdfProvenance: validPdf() },
      ],
      flashcards: [
        { front: "What is a METAR?", back: "A routine surface weather observation.", sourcePage: 12, pdfProvenance: validPdf() },
        { front: "BKN means?", back: "Broken: 5/8 to 7/8 sky cover.", sourcePage: null },
      ],
    });

  /** Every item in the set came from the PDF kit. */
  const allKit = () =>
    studySet({
      summary: "How METARs and TAFs describe the weather.",
      summaryPdfProvenance: validPdf(),
      sections: [
        { heading: "Reading a METAR", body: "- Station\n- Time\n- **Wind** first", pdfProvenance: validPdf() },
        { heading: "Ceilings", body: "The lowest broken or overcast layer.", pdfProvenance: validPdf() },
      ],
      flashcards: [
        { front: "What is a METAR?", back: "A routine surface weather observation.", sourcePage: 12, pdfProvenance: validPdf() },
        { front: "BKN means?", back: "Broken: 5/8 to 7/8 sky cover.", sourcePage: null, pdfProvenance: validPdf() },
      ],
    });

  /** Only the flashcards came from the kit; the guide did not. */
  const kitCardsOnly = () =>
    studySet({
      summary: "How METARs and TAFs describe the weather.",
      sections: [{ heading: "Reading a METAR", body: "- Station\n- Time\n- **Wind** first" }],
      flashcards: [
        { front: "What is a METAR?", back: "A routine surface weather observation.", sourcePage: 12, pdfProvenance: validPdf() },
      ],
    });

  const noteOf = (input: ExportSource, selection = ALL) =>
    (JSON.parse(exported(input, selection).text) as { source: { note: string } }).source.note;

  it("mixed_set_packet_note_says_some_items", () => {
    const note = noteOf(source({ studySet: mixedKit() }));
    expect(note).toContain("Some items pulled from a PDF on the sender's Mac.");
    expect(note).not.toContain("Pulled from a PDF on the sender's Mac.");
    expect(note).toContain("AI-generated study aid (gemini-3.5-flash).");
    expect(note).not.toContain("on this Mac");
  });

  it("all_kit_set_packet_note_unchanged", () => {
    const note = noteOf(source({ studySet: allKit() }));
    expect(note).toContain("Pulled from a PDF on the sender's Mac.");
    expect(note).not.toContain("Some items pulled");
    expect(note).not.toContain("on this Mac");
  });

  it("selection_scopes_pdf_note", () => {
    const input = source({ studySet: kitCardsOnly() });
    const guideOnly = noteOf(input, { guide: true, flashcards: false, questions: false });
    expect(guideOnly).not.toContain("on the sender's Mac");
    expect(guideOnly).not.toContain("your PDF");
    const withCards = noteOf(input, { guide: true, flashcards: true, questions: false });
    expect(withCards).toContain("Some items pulled from a PDF on the sender's Mac.");
  });
});

describe("practice authorship export privacy (OFFLINE-03b)", () => {
  const mixed = () => practiceTest({ questions: [
    { ...practiceTest().questions[0]!, origin: "user" },
    { ...practiceTest().questions[1]!, origin: "instructor", explanation: "Private CFI explanation" },
  ] });

  it("detects authorship in a test while preserving set-only calls", () => {
    expect(hasInstructorCorrections(null)).toBe(false);
    expect(hasHandwrittenItems(null)).toBe(false);
    expect(hasInstructorCorrections(studySet())).toBe(false);
    expect(hasHandwrittenItems(studySet())).toBe(false);
    expect(hasInstructorCorrections(null, mixed())).toBe(true);
    expect(hasHandwrittenItems(null, mixed())).toBe(true);
    expect(hasHandwrittenItems(null, practiceTest({ provider: "manual" }))).toBe(true);
  });

  it("excludes instructor questions before serialization unless deliberately included", () => {
    const input = source({ studySet: null, practiceTest: mixed() });
    const left = exportStudyPacket(input, ALL, NOW);
    if (!left.ok) throw new Error(left.message);
    expect(left.counts.questions).toBe(1);
    expect(left.text).not.toContain("A TAF");
    expect(left.text).not.toContain("Private CFI explanation");
    const included = exportStudyPacket(input, { ...ALL, instructorCorrections: true }, NOW);
    if (!included.ok) throw new Error(included.message);
    expect(included.counts.questions).toBe(2);
    expect(included.text).toContain("Private CFI explanation");
    expect(input.practiceTest?.questions).toHaveLength(2);
  });

  it("has no exportable questions when every question is an instructor correction", () => {
    const input = source({ studySet: null, practiceTest: practiceTest({ questions: [mixed().questions[1]!] }) });
    const effective = exportSourceFor(input, {});
    expect(effective.practiceTest).toBeNull();
    expect(exportableParts(effective).questions).toBe(false);
    expect(exportStudyPacket(input, ALL, NOW)).toEqual({ ok: false, message: EXPORT_MESSAGES.nothingChosen });
    expect(exportableParts(exportSourceFor(input, { instructorCorrections: true })).questions).toBe(true);
  });

  it.each(["gemini", "import"] as const)("adds the handwritten supplement exactly once for a %s test", (provider) => {
    const input = source({ practiceTest: { ...mixed(), provider } });
    const supplement = "Some items were written or corrected by hand in Her Flight Deck, not generated.";
    for (const handwrittenSet of [null, studySet({ summaryOrigin: "user" })]) {
      const result = exportStudyPacket({ ...input, studySet: handwrittenSet }, ALL, NOW);
      if (!result.ok) throw new Error(result.message);
      const note = JSON.parse(result.text).source.note as string;
      expect(note.split(supplement)).toHaveLength(2);
    }
    const filtered = exportSourceFor(source({ studySet: null, practiceTest: practiceTest({ questions: [practiceTest().questions[0]!, mixed().questions[1]!] }) }), {});
    expect(provenanceNote(filtered, ALL)).not.toContain(supplement);
  });

  it("describes a manual test as handwritten without calling it AI-generated", () => {
    const result = exportStudyPacket(source({ studySet: null, practiceTest: practiceTest({ provider: "manual", model: "" }) }), ALL, NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.text).toContain("Written by hand in Her Flight Deck; not checked by the app.");
    expect(result.text).not.toContain("AI-generated");
  });

  it("keeps v1 strict even when authored practice questions carry lineage", () => {
    const questions = mixed().questions.map((question, index) => ({ ...question, identity: `private-identity-${index}`, replaces: `private-replacement-${index}` }));
    const result = exportStudyPacket(source({ practiceTest: practiceTest({ questions }) }), { ...ALL, instructorCorrections: true }, NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.text.match(/"(?:origin|identity|replaces)"\s*:/g)).toBeNull();
    const validation = validatePacketText(result.text);
    if (!validation.ok) throw new Error("invalid packet");
    for (const question of validation.payload.practiceTest!.questions) {
      expect(Object.keys(question).sort()).toEqual(["correctIndex", "explanation", "options", "question", "sourcePage"]);
    }
  });
});
