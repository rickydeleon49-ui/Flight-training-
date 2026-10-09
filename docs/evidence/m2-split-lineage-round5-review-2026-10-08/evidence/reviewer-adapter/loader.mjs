// Reviewer import-only redirect to the round-5 model.
const R5 = '/m2-split-lineage-scope-round5-2026-10-08/proof/lineageContract.mjs';
export async function resolve(specifier, context, next) {
  const m = specifier.match(/\/m2-split-lineage-scope(?:-corrections|-round2|-round3|-round4)?-2026-10-08\/proof\/lineageContract\.mjs$/);
  return m ? next(specifier.slice(0, m.index) + R5, context) : next(specifier, context);
}
