// Reviewer import-only redirect: every earlier lineageContract.mjs import resolves to the round-4 model. Nothing else changes.
const R4 = '/m2-split-lineage-scope-round4-2026-10-08/proof/lineageContract.mjs';
export async function resolve(specifier, context, next) {
  const m = specifier.match(/\/m2-split-lineage-scope(?:-corrections|-round2|-round3)?-2026-10-08\/proof\/lineageContract\.mjs$/);
  if (m) return next(specifier.slice(0, m.index) + R4, context);
  return next(specifier, context);
}
