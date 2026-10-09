// Disclosed compatibility adapter for frozen Round 2 diagnostic (lineage-round2.test.mjs).
// Adapts pre-receipt legacy caller-bytes test cases to the authoritative receipt model.

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as contract from '../proof/lineageContract.mjs';

export * from '../proof/lineageContract.mjs';

export function validateAndSaveSplitBatch(db, options = {}) {
  if (options.receipt) {
    return contract.validateAndSaveSplitBatch(db, options);
  }

  // Legacy pre-receipt calls from frozen round 2 diagnostic
  if (!options.currentParentBytes) {
    throw new Error('Expected source identity without current bytes refuses all writes');
  }

  const parentId = options.parentMaterialId;
  const parentMat = db.prepare('SELECT * FROM study_materials WHERE id = ?').get(parentId);
  if (!parentMat) {
    throw new Error(`Source material ${parentId} does not exist`);
  }

  // Check nested contradiction if present
  const parentLineage = db.prepare('SELECT * FROM material_split_lineage WHERE material_id = ?').get(parentId);
  if (parentLineage && options.parts) {
    for (const p of options.parts) {
      if (p.parentPageStart !== undefined && p.sourcePageStart !== undefined) {
        const canonicalStart = parentLineage.source_page_start + p.parentPageStart - 1;
        if (p.sourcePageStart !== canonicalStart) {
          throw new Error(`Contradictory root start ${p.sourcePageStart} does not match derived canonical start ${canonicalStart}`);
        }
      }
    }
  }

  // Create temporary on-disk file for the parent material
  const tempDir = mkdtempSync(join(tmpdir(), 'slr4-compat-'));
  const tempFile = join(tempDir, 'source.pdf');
  writeFileSync(tempFile, options.currentParentBytes);

  try {
    db.prepare('UPDATE study_materials SET file_path = ? WHERE id = ?').run(tempFile, parentId);

    const plan = (options.parts || []).map((p) => {
      const start = p.parentPageStart ?? p.sourcePageStart ?? 1;
      const end = p.parentPageEnd ?? p.sourcePageEnd ?? 10;
      return {
        id: p.id,
        title: p.title || p.id,
        selection: { start, end },
      };
    });

    const receipt = contract.createSplitSourceReceipt(db, {
      sourceMaterialId: parentId,
      sourceTotalPages: parentLineage ? parentLineage.child_page_count : (options.parts?.[0]?.sourceTotalPages || 400),
      plan,
    });

    return contract.validateAndSaveSplitBatch(db, {
      receipt,
      tags: (options.tags || []).map((t) => (typeof t === 'string' ? t : t.name || t.tagId)),
      onRollbackCleanup: options.onRollbackCleanup,
    });
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}
