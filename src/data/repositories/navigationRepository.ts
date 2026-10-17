/**
 * Document navigation (M4 Slice 1). Every write is one owned driver call:
 * reservations, commits, read confirmation and bookmarks run as single
 * immediate transactions (`navigation.rs` natively, `navigationTransaction.ts`
 * in the browser). Checking a file's pages and handing it to the reader need
 * the desktop application; in browser mode they refuse with DESKTOP_ONLY.
 *
 * Not loaded through AppDataContext: the material view and the source badges
 * use it on demand through `useDocumentNavigation`.
 */
import type { InspectedNavigationIdentity, NavigationOperation, NavigationResultByKind } from "@/domain/types";

import type { SqlDatabase } from "../db";
import { refuse } from "../navigationTransaction";

export function navigationRepository(db: SqlDatabase) {
  return {
    /** Whether saved places and bookmarks can be stored at all. */
    supported(): boolean {
      return typeof db.navigationOperation === "function";
    },
    /** Whether a file's pages can be checked and opened at a verified page. */
    canCheckFiles(): boolean {
      return typeof db.inspectNavigationIdentity === "function" && typeof db.openNavigationDocument === "function";
    },
    async operation<K extends NavigationOperation["kind"]>(op: Extract<NavigationOperation, { kind: K }>): Promise<NavigationResultByKind[K]> {
      if (typeof db.navigationOperation !== "function") return refuse("DESKTOP_ONLY");
      return db.navigationOperation(op);
    },
    async inspect(materialId: string): Promise<InspectedNavigationIdentity> {
      if (typeof db.inspectNavigationIdentity !== "function") return refuse("DESKTOP_ONLY");
      return db.inspectNavigationIdentity(materialId);
    },
    async open(materialId: string, expectedContentSha256: string): Promise<void> {
      if (typeof db.openNavigationDocument !== "function") return refuse("DESKTOP_ONLY");
      return db.openNavigationDocument(materialId, expectedContentSha256);
    },
  };
}

export type NavigationRepository = ReturnType<typeof navigationRepository>;
