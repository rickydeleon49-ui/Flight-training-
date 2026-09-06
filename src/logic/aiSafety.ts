/**
 * What may be sent to Gemini, and what may not.
 *
 * Generating a study aid uploads the selected file to Google. On the free
 * tier Google states that inputs and outputs may be used to improve its
 * products, so the decision deserves more than a paragraph of advice in
 * Settings.
 *
 * Two categories are refused outright rather than warned about, because they
 * are the ones where a single mistaken click is unrecoverable:
 *
 *   - a file attached to a certificate, medical or identification record;
 *   - anything filed as an administrative document.
 *
 * Everything else is allowed, but only after a confirmation that names the
 * file, so sending is always a deliberate act.
 */
import { MATERIAL_TYPE_LABELS, type CredentialRecord, type StudyMaterial } from "@/domain/types";

export interface AiSubmissionCheck {
  allowed: boolean;
  /** Shown to her: why it is refused, or what she is agreeing to. */
  reason: string;
}

/** Material types that routinely hold personal or identifying details. */
const REFUSED_TYPES: ReadonlySet<StudyMaterial["materialType"]> = new Set(["admin_document"]);

export function checkAiSubmission(
  material: StudyMaterial,
  credentials: CredentialRecord[],
): AiSubmissionCheck {
  if (!material.filePath) {
    return {
      allowed: false,
      reason: "This material has no file attached, so there is nothing to send.",
    };
  }

  const attachedTo = credentials.find((record) => record.materialId === material.id);
  if (attachedTo) {
    return {
      allowed: false,
      reason:
        `This file is attached to your record "${attachedTo.title}". Certificates, ` +
        "medicals and identification are never sent to Google. Keep a separate copy " +
        "in the library if you want a study aid from part of it.",
    };
  }

  if (REFUSED_TYPES.has(material.materialType)) {
    return {
      allowed: false,
      reason:
        `This is filed as an ${MATERIAL_TYPE_LABELS[material.materialType]}, which often ` +
        "holds personal details. Change its type if it is really study material.",
    };
  }

  return {
    allowed: true,
    reason:
      `"${material.originalFileName ?? material.title}" will be uploaded to Google to ` +
      "generate the study aid. On the free tier Google may use it to improve its " +
      "products, so send study material only — never anything personal or identifying.",
  };
}
