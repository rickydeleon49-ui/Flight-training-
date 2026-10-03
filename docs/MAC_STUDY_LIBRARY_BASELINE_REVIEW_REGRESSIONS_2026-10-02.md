# Independent Mac baseline review regressions — 2 October 2026

Diagnostic source only; not production instrumentation. Run against Claude's matching local baseline files, not main (which does not include those modules yet). Codex temporarily ran this as `src/perf/codexReview.diagnostic.test.ts`, then removed it and verified all four implementer source hashes unchanged.

Observed command: `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx --no-install vitest run src/perf/codexReview.diagnostic.test.ts`.

Observed result: exit 1, 1 failed / 1 passed. The negative preservation requirement failed because the harness accepted a wrong intermediate card ID. The separate repeated-expansion check passed, confirming 500 shown cards for 1,000 records after four clicks.

```text
Independent review: wrong intermediate card ID observed; injected once; harness still accepted the scenario.
FAIL must reject a wrong result at an intermediate measured keystroke
AssertionError: promise resolved instead of rejecting
Tests 1 failed | 1 passed (2)
```

Integrate the transient-mismatch behavior into a maintained regression during the correction. The injected fault and its observation both occurred once before the failing rejection assertion; the fault was restored before the final query state. The afterStep callback already exists in the harness and is used here solely by the reviewer diagnostic.

```ts
// @vitest-environment jsdom
import { createElement as h } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { createNodeSqliteDatabase, type TestDatabase } from '@/data/testing/nodeSqliteDb';
import { createRepositories } from '@/data/repositories';
import { StudyLibrary } from '@/pages/StudyLibrary/StudyLibrary';
import { AppDataProvider, useAppData } from '@/state/AppDataContext';
import { fixtureLibrary, seedFixtureMaterials } from './studyLibraryFixture';
import { SCENARIOS, renderedResult, runLibraryScenarios } from './studyLibraryHarness';
let db: TestDatabase | null = null;
let context: ReturnType<typeof useAppData> | null = null;
vi.mock('@/data', () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
const originalScenarios = [...SCENARIOS];
const meter = { reset() {}, read: () => ({ renders: 0, renderMs: 0, selects: 0, executes: 0 }) };
function Probe() { context = useAppData(); return null; }
async function mount(total: number) {
  const materials = fixtureLibrary(total);
  db = await createNodeSqliteDatabase();
  await createRepositories(db).app.set('airline_starter_pack', 'skipped-for-review');
  await seedFixtureMaterials(db, materials);
  render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ['/study'] },
    h(Probe), h(Routes, null, h(Route, { path: '/study', element: h(StudyLibrary) })))));
  await waitFor(() => expect(context?.status).toBe('ready'));
  return materials;
}
afterEach(() => { cleanup(); db?.close(); db = null; context = null; sessionStorage.clear(); SCENARIOS.splice(0, SCENARIOS.length, ...originalScenarios); });
it('must reject a wrong result at an intermediate measured keystroke', async () => {
  const materials = await mount(240);
  const scenario = originalScenarios.find(s => s.name === 'narrowingQueryTyped')!;
  SCENARIOS.splice(0, SCENARIOS.length, scenario);
  let injected = 0;
  let sawWrongResult = false;
  let altered: HTMLAnchorElement | null = null;
  let priorHref: string | null = null;
  const work = runLibraryScenarios({ materials, loaded: () => context!.data.materials, meter, repeats: 1, warmups: 0,
    afterStep() {
      if (altered && priorHref) altered.setAttribute('href', priorHref);
      altered = null;
      const query = (document.querySelector('[aria-label="Search your library"]') as HTMLInputElement).value;
      if (query !== 'airspace c') return;
      altered = document.querySelector<HTMLAnchorElement>('a.material-card');
      if (!altered) throw new Error('No card available for the independent fault');
      priorHref = altered.getAttribute('href');
      altered.setAttribute('href', '/study/reviewer-wrong-id');
      injected++;
      sawWrongResult = renderedResult().shownIds.includes('reviewer-wrong-id');
    }
  });
  const accepted = await work;
  expect(injected).toBe(1);
  expect(sawWrongResult).toBe(true);
  console.log("Independent review: wrong intermediate card ID observed; injected once; harness still accepted the scenario.");
  await expect(Promise.resolve(accepted)).rejects.toThrow(/answer key|ids\/order/);
}, 30000);
it('shows 500 cards after repeated Show more, confirming the list is not capped at 100', async () => {
  const materials = await mount(1000);
  const scenario = originalScenarios.find(s => s.name === 'showMoreProgressive')!;
  SCENARIOS.splice(0, SCENARIOS.length, { ...scenario, measured: Array.from({length:4}, () => ({ kind:'showMore' as const })) });
  const result = await runLibraryScenarios({ materials, loaded: () => context!.data.materials, meter, repeats:1, warmups:0 });
  expect(result.showMoreProgressive).toMatchObject({ shownCount:500, resultCount:1000 });
}, 30000);
```
