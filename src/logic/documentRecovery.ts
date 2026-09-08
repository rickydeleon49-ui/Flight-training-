import type { ImportedDocument } from "@/services/documents";

export async function restoreDocumentCopy(
  materialId: string,
  choose: (id: string) => Promise<ImportedDocument | null>,
  save: (document: ImportedDocument) => Promise<void>,
  remove: (relativePath: string) => Promise<void>,
): Promise<ImportedDocument | null> {
  const document = await choose(materialId);
  if (!document) return null;

  try {
    await save(document);
    return document;
  } catch (error) {
    try {
      await remove(document.relativePath);
    } catch {
      // Keep the database error: it explains why recovery did not complete.
    }
    throw error;
  }
}
