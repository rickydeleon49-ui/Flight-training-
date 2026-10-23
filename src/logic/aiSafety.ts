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
  content: "file" | "study_context" = "file",
): AiSubmissionCheck {
  if (!material.filePath && content === "file") {
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

  if (content === "study_context") {
    return { allowed: true, reason: "Your question and study context will be sent to Google. Send study material only — never anything personal or identifying." };
  }

  const name = material.originalFileName ?? material.title;
  // Only PDFs are kept at Google for reuse; other files go with the request.
  const reuse = name.toLowerCase().endsWith(".pdf")
    ? " (if Google already has a copy from the last 48 hours, that copy is used instead)"
    : "";
  return {
    allowed: true,
    reason:
      `"${name}" will be sent to Google to generate the study aid${reuse}. ` +
      "On the free tier Google may use it to improve its " +
      "products, so send study material only — never anything personal or identifying.",
  };
}

/**
 * Exactly what leaves this Mac when she confirms, and what Google keeps
 * (GEN-REL-01). A PDF is uploaded once to Google's temporary file storage so a
 * study guide and a practice test can both use it; anything else is sent with
 * the one request. A split part names the pages of the original it holds, so
 * "only this chapter" is visible before anything is sent.
 */
export function geminiSendDisclosure(material: StudyMaterial): string {
  const name = material.originalFileName ?? material.title;
  const isPdf = (material.originalFileName ?? material.filePath ?? "").toLowerCase().endsWith(".pdf");
  const lineage = material.lineage;
  const pages = lineage ? `, pages ${lineage.sourcePageStart}–${lineage.sourcePageEnd} of “${lineage.sourceTitle}”,` : "";
  if (!isPdf) {
    return `Only “${name}” leaves this Mac. It is sent with this request only; it is not stored for reuse. Your copy on this Mac is not changed.`;
  }
  return (
    `Only “${name}”${pages} leaves this Mac. Google keeps a temporary copy for up to 48 hours so a study guide and ` +
    "a practice test can use it without uploading it again. Her Flight Deck asks Google to delete it sooner when " +
    "the file changes or you disconnect Gemini; otherwise Google removes it when it expires. Your copy on this Mac is not changed."
  );
}
