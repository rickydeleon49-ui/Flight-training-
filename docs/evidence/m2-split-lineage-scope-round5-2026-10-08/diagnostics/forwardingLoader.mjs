// Import-only resolve hook: redirects earlier lineageContract.mjs imports to round-5 model.
const R5 = '/m2-split-lineage-scope-round5-2026-10-08/proof/lineageContract.mjs';

export async function resolve(specifier, context, next) {
  const m = specifier.match(/\/m2-split-lineage-scope(?:-corrections|-round2|-round3|-round4)?-2026-10-08\/proof\/lineageContract\.mjs$/);
  if (m) {
    return next(specifier.slice(0, m.index) + R5, context);
  }
  return next(specifier, context);
}
