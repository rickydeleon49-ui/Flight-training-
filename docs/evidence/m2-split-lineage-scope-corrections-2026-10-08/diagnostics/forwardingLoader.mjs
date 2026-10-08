export async function resolve(specifier, context, nextResolve) {
  if (specifier.includes('m2-split-lineage-scope-2026-10-08/proof/lineageContract.mjs')) {
    const corrected = specifier.replace(
      'm2-split-lineage-scope-2026-10-08/proof/lineageContract.mjs',
      'm2-split-lineage-scope-corrections-2026-10-08/proof/lineageContract.mjs'
    );
    return nextResolve(corrected, context);
  }
  return nextResolve(specifier, context);
}
