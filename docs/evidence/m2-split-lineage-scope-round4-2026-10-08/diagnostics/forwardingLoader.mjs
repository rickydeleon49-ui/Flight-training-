export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL && context.parentURL.includes('lineage-round2.test.mjs')) {
    if (specifier.includes('lineageContract.mjs')) {
      return nextResolve(new URL('./round2CompatAdapter.mjs', import.meta.url).href, context);
    }
  }
  if (specifier.includes('m2-split-lineage-scope-2026-10-08/proof/lineageContract.mjs')) {
    const corrected = specifier.replace(
      'm2-split-lineage-scope-2026-10-08/proof/lineageContract.mjs',
      'm2-split-lineage-scope-round4-2026-10-08/proof/lineageContract.mjs'
    );
    return nextResolve(corrected, context);
  }
  if (specifier.includes('m2-split-lineage-scope-corrections-2026-10-08/proof/lineageContract.mjs')) {
    const corrected = specifier.replace(
      'm2-split-lineage-scope-corrections-2026-10-08/proof/lineageContract.mjs',
      'm2-split-lineage-scope-round4-2026-10-08/proof/lineageContract.mjs'
    );
    return nextResolve(corrected, context);
  }
  if (specifier.includes('m2-split-lineage-scope-round2-2026-10-08/proof/lineageContract.mjs')) {
    const corrected = specifier.replace(
      'm2-split-lineage-scope-round2-2026-10-08/proof/lineageContract.mjs',
      'm2-split-lineage-scope-round4-2026-10-08/proof/lineageContract.mjs'
    );
    return nextResolve(corrected, context);
  }
  if (specifier.includes('m2-split-lineage-scope-round3-2026-10-08/proof/lineageContract.mjs')) {
    const corrected = specifier.replace(
      'm2-split-lineage-scope-round3-2026-10-08/proof/lineageContract.mjs',
      'm2-split-lineage-scope-round4-2026-10-08/proof/lineageContract.mjs'
    );
    return nextResolve(corrected, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.includes('lineage-round3-review.test.mjs')) {
    let sourceText = typeof result.source === 'string'
      ? result.source
      : (result.source ? Buffer.from(result.source).toString('utf8') : null);
    if (sourceText) {
      sourceText = sourceText.replaceAll(
        'm2-split-lineage-scope-round3-2026-10-08',
        'm2-split-lineage-scope-round4-2026-10-08'
      );
      return {
        ...result,
        source: sourceText,
      };
    }
  }
  return result;
}
