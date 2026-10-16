/**
 * Fixture-binding adapter for the frozen round-3 diagnostics (M4-R34, round 5).
 *
 * The frozen [M4-R29] diagnostic seeds page 5 with `saveReadingState(id, 5, { generation: 1 })`
 * without reserving token 1. The corrected protocol authorizes a write only for the exact,
 * currently reserved token, so that unreserved seed is (correctly) refused. This adapter changes
 * fixture seeding only: when a seed names a generation and no claim exists yet for the material,
 * it first reserves that exact token through the real protocol, then commits through the real,
 * unchanged commit path. Every other call is the corrected class. The frozen diagnostics' order,
 * inputs and expectations are not edited.
 */
import { DocumentPersistenceProtocol as CorrectedProtocol } from "../../../m4-document-navigation-integration-corrections-r2-2026-10-11/proof/persistenceProtocol.mjs";

export class DocumentPersistenceProtocol extends CorrectedProtocol {
  saveReadingState(materialId, lastRequestedPage, options = {}) {
    const generation = options.generation;
    if (Number.isSafeInteger(generation) && generation >= 1) {
      const claim = this.db
        .prepare("SELECT reserved_generation FROM material_operation_claims WHERE material_id = ?")
        .get(materialId);
      if (!claim) {
        const token = this.reserveOperationOwnership(materialId, generation - 1);
        if (token !== generation) {
          throw new Error(`fixture adapter expected to reserve token ${generation}, got ${token}`);
        }
      }
    }
    return super.saveReadingState(materialId, lastRequestedPage, options);
  }
}
