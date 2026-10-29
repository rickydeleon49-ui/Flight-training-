import type { FaaReferenceCopy, StudyMaterial } from "@/domain/types";
import type { ImportedDocument } from "@/services/documents";

/** Approved 01b metadata only. No official byte hashes or reviewed destinations. */
export const FAA_REFERENCES = [
  {
    id: "private-acs",
    title: "Private Pilot Airplane ACS",
    edition: "FAA-S-ACS-6C",
    publication: "April 2024 · Effective May 31, 2024",
    source: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
  },
  {
    id: "phak",
    title: "Pilot’s Handbook of Aeronautical Knowledge (PHAK)",
    edition: "FAA-H-8083-25C",
    publication: "2023",
    source: "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/phak",
  },
  {
    id: "phak-addendum",
    title: "PHAK addendum",
    edition: "FAA-H-8083-25C · MOSAIC addendum",
    publication: "October 2025",
    source: "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/PHAK_Addendum_(MOSAIC).pdf",
  },
] as const;

export type FaaReference = typeof FAA_REFERENCES[number];
export type FaaReferenceNote = FaaReferenceCopy;

export function faaReferenceDraft(reference: FaaReference, id: string, edition: string, imported: ImportedDocument) {
  if (!imported.pdfIdentity || imported.pdfIdentity.totalPages < 1) {
    throw new Error("Choose a readable PDF with at least one page.");
  }
  const receipt: FaaReferenceNote = {
    referenceId: reference.id,
    edition: edition.replace(/[\r\n]/g, " ").trim().slice(0, 200),
    ...imported.pdfIdentity,
  };
  return {
    id,
    title: receipt.edition ? `${reference.title} — ${receipt.edition}` : reference.title,
    faaReference: receipt,
    materialType: "reference" as const,
    topic: "general" as const,
    reviewStatus: "reference_only" as const,
    priority: "later" as const,
    goalId: null,
    eventId: null,
    tags: [],
    notes: "",
    filePath: imported.relativePath,
    originalFileName: imported.originalFileName,
    fileSize: imported.fileSize,
  };
}

export function faaEditionMessage(reference: FaaReference, note: FaaReferenceNote): string {
  // The row already shows the listed edition; add hers only when she typed a different one.
  return note.edition && note.edition !== reference.edition ? `Your copy: ${note.edition}` : "";
}

export type FaaAvailability = "checking" | "present" | "missing" | "changed" | "unknown" | "browser";
export function faaAvailability(
  note: FaaReferenceNote,
  current: ImportedDocument["pdfIdentity"],
): FaaAvailability {
  if (!current) return "missing";
  if (current.contentSha256 !== note.contentSha256 || current.totalPages !== note.totalPages) return "changed";
  return "present";
}

export function faaShelfCopies(materials: StudyMaterial[], reference: FaaReference) {
  return materials.flatMap((material) => {
    const note = material.faaReference;
    return note?.referenceId === reference.id ? [{ material, note }] : [];
  });
}
