import type { PdfItemProvenance } from "@/data/pdfKitSources";
import { PDF_KIT_LABEL, pdfEditLabel } from "@/logic/pdfKitLabels";
export { PDF_KIT_LABEL, PDF_KIT_REMINDER } from "@/logic/pdfKitLabels";
export function PdfItemLabel({ provenance, origin, sectionLabelled = false }: { provenance?: PdfItemProvenance; origin?: unknown; sectionLabelled?: boolean }) {
  if (!provenance) return null;
  if (sectionLabelled && provenance.status === "valid") {
    const edit = pdfEditLabel(origin);
    return edit ? <span className="tiny muted">{edit}</span> : null;
  }
  return <span className="tiny muted">{provenance.status === "valid" ? PDF_KIT_LABEL : "Source details unavailable"}{provenance.status === "valid" && origin === "user" ? <span> · <span>Edited by you</span></span> : null}{provenance.status === "valid" && origin === "instructor" ? <span> · <span>Corrected by your instructor</span></span> : null}</span>;
}
