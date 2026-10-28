import { describe, expect, it } from "vitest";
import { makeMaterial } from "@/testing/factories";
import { FAA_REFERENCES, faaAvailability, faaEditionMessage, faaReferenceDraft, faaShelfCopies } from "./faaReferences";

const imported = {
  relativePath: "synthetic.pdf", originalFileName: "FAA-S-ACS-6C.pdf", fileSize: 100,
  pdfIdentity: { contentSha256: "a".repeat(64), totalPages: 1 },
};

describe("FAA document shelf intake", () => {
  it("keeps all three optional publications as unmapped reference-only materials", () => {
    for (const reference of FAA_REFERENCES) {
      const draft = faaReferenceDraft(reference, "new-id", reference.edition, imported);
      expect(draft).toMatchObject({ materialType: "reference", reviewStatus: "reference_only", priority: "later", tags: [], goalId: null, eventId: null });
      const note = draft.faaReference;
      expect(note).toMatchObject({ referenceId: reference.id, edition: reference.edition, ...imported.pdfIdentity });
      expect(faaEditionMessage(reference, note)).toBe("Edition not checked");
      expect(draft.notes).toBe("");
      expect(draft.title).toBe(`${reference.title} — ${reference.edition}`);
    }
  });

  it("does not treat a convincing filename as proof; flags another edition calmly", () => {
    const draft = faaReferenceDraft(FAA_REFERENCES[0], "id", "FAA-S-ACS-6B", imported);
    expect(faaEditionMessage(FAA_REFERENCES[0], draft.faaReference)).toBe(
      "Your copy: FAA-S-ACS-6B · Edition not checked",
    );
    const unknown = faaReferenceDraft(FAA_REFERENCES[0], "id", "", imported);
    expect(unknown.title).toBe(FAA_REFERENCES[0].title);
    expect(unknown.faaReference.edition).toBe("");
  });

  it("keeps old copies separate and never infers a shelf link from a title or ACS tag", () => {
    const old = makeMaterial(faaReferenceDraft(FAA_REFERENCES[0], "old", "6B", imported));
    const next = makeMaterial(faaReferenceDraft(FAA_REFERENCES[0], "new", "6C", imported));
    const ordinary = makeMaterial({ title: FAA_REFERENCES[0].title, tags: ["PA.I.A.K1"] });
    expect(faaShelfCopies([old, next, ordinary], FAA_REFERENCES[0]).map(({ material }) => material.id)).toEqual(["old", "new"]);
  });

  it("rejects absent PDF identity", () => {
    expect(() => faaReferenceDraft(FAA_REFERENCES[0], "id", "", { ...imported, pdfIdentity: null })).toThrow();
  });

  it("distinguishes present, missing, changed bytes and changed page count", () => {
    const note = faaReferenceDraft(FAA_REFERENCES[0], "id", "", imported).faaReference;
    expect(faaAvailability(note, imported.pdfIdentity)).toBe("present");
    expect(faaAvailability(note, null)).toBe("missing");
    expect(faaAvailability(note, { ...imported.pdfIdentity, contentSha256: "b".repeat(64) })).toBe("changed");
    expect(faaAvailability(note, { ...imported.pdfIdentity, totalPages: 0 })).toBe("changed");
  });
});
