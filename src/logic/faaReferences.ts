import type { StudyMaterial } from "@/domain/types";
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
export interface FaaReferenceNote {
  version: 1;
  referenceId: FaaReference["id"];
  edition: string;
  contentSha256: string;
  totalPages: number;
}
const PREFIX = "FAA reference: ";

/** Ordinary material notes carry this local intake receipt through existing backup. */
export function readFaaReference(notes: string): FaaReferenceNote | null {
  const [title, editionLine, hashLine, pagesLine] = notes.split("\n");
  const reference = FAA_REFERENCES.find((ref) => title === `${PREFIX}${ref.title}`);
  if (!reference || !editionLine?.startsWith("Saved edition: ") ||
      !hashLine?.startsWith("Local copy SHA-256: ") || !pagesLine?.startsWith("Local copy pages: ")) return null;
  const edition = editionLine.slice("Saved edition: ".length);
  const contentSha256 = hashLine.slice("Local copy SHA-256: ".length);
  const totalPages = Number(pagesLine.slice("Local copy pages: ".length));
  if (edition.length > 200 || !/^[a-f0-9]{64}$/.test(contentSha256) ||
      !Number.isSafeInteger(totalPages) || totalPages < 1) return null;
  return { version: 1, referenceId: reference.id, edition, contentSha256, totalPages };
}

export function faaReferenceDraft(reference: FaaReference, id: string, edition: string, imported: ImportedDocument) {
  if (!imported.pdfIdentity || imported.pdfIdentity.totalPages < 1) {
    throw new Error("Choose a readable PDF with at least one page.");
  }
  const receipt: FaaReferenceNote = {
    version: 1,
    referenceId: reference.id,
    edition: edition.replace(/[\r\n]/g, " ").trim().slice(0, 200),
    ...imported.pdfIdentity,
  };
  return {
    id,
    title: `${reference.title} — ${receipt.edition || "Edition not checked"}`,
    materialType: "reference" as const,
    topic: "general" as const,
    reviewStatus: "reference_only" as const,
    priority: "later" as const,
    goalId: null,
    eventId: null,
    tags: [],
    notes: `${PREFIX}${reference.title}\nSaved edition: ${receipt.edition}\nLocal copy SHA-256: ${receipt.contentSha256}\nLocal copy pages: ${receipt.totalPages}\nEdition not checked. Edition entered by you; the local hash only detects changes.\nListed edition: ${reference.edition}. ${reference.publication}.\nOfficial source (not checked for this file): ${reference.source}\nSource list last checked: 2026-10-28. Newer editions may exist.`,
    filePath: imported.relativePath,
    originalFileName: imported.originalFileName,
    fileSize: imported.fileSize,
  };
}

export function faaEditionMessage(reference: FaaReference, note: FaaReferenceNote): string {
  if (note.edition && note.edition !== reference.edition) {
    return "Different edition noted — kept as a separate copy. Edition not checked.";
  }
  return "Edition not checked";
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
    const note = readFaaReference(material.notes);
    return note?.referenceId === reference.id ? [{ material, note }] : [];
  });
}
