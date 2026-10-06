// @vitest-environment jsdom
import { createElement as h, type ContextType } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepositories, type Repositories } from '@/data/repositories';
import { createNodeSqliteDatabase, type TestDatabase } from '@/data/testing/nodeSqliteDb';
import type { PracticeTest } from '@/domain/types';
import { PracticeTestPanel } from './PracticeTestPanel';
import { PracticeHistory } from './PracticeHistory';
import { AppDataContext, EMPTY_DATA } from '@/state/AppDataContext';

let db: TestDatabase;
let repos: Repositories;
function deferred<T>() {
 let resolve!: (value: T) => void;
 const promise = new Promise<T>(r => { resolve = r; });
 return { promise, resolve };
}
beforeEach(async () => {
 db = await createNodeSqliteDatabase();
 repos = createRepositories(db);
 HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
 HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); db.close(); });
function wrap(child: ReturnType<typeof h>, route = '/') {
 const value = { repositories: repos, data: EMPTY_DATA, status: 'ready', error: null } as ContextType<typeof AppDataContext>;
 return h(AppDataContext.Provider, { value }, h(MemoryRouter, { initialEntries: [route] }, child));
}
async function seed(id: string): Promise<PracticeTest> {
 await repos.documents.create({ id, title: `Material ${id}` });
 await repos.documents.savePracticeTest({ sourceMaterialId: id, title: id, model: 'synthetic', questions: [
  { question: `Frozen ${id} question 1`, options: ['First', 'Second'], correctIndex: 0, explanation: `Confirmed ${id} explanation`, sourcePage: null },
  { question: `Frozen ${id} question 2`, options: ['Third', 'Fourth'], correctIndex: 1, explanation: 'Second explanation', sourcePage: null },
 ] });
 return (await repos.documents.listPracticeTests()).find(t => t.sourceMaterialId === id)!;
}
async function start(id: string) {
 const version = (await repos.practiceSessions.getActiveVersion(id))!;
 return repos.practiceSessions.saveSessionAction({ action: 'start_or_resume', operationId: crypto.randomUUID(), materialId: id, versionId: version.version.id });
}
async function complete(id: string) {
 const state = await start(id);
 if (!('attemptId' in state) || !('revision' in state)) throw Error('Unexpected state');
 return repos.practiceSessions.saveSessionAction({ action: 'complete_attempt', operationId: crypto.randomUUID(), attemptId: state.attemptId, expectedRevision: state.revision });
}
async function panel(test: PracticeTest) {
 const load = vi.spyOn(repos.practiceSessions, 'getCurrentAttempt');
 const view = render(wrap(h(PracticeTestPanel, { practiceTest: test })));
 await waitFor(() => expect(load).toHaveBeenCalledWith(test.sourceMaterialId));
 await act(async () => { await Promise.resolve(); });
 return view;
}
async function answerConfirmed() {
 fireEvent.click(screen.getAllByRole('radio')[0]!);
 await waitFor(async () => expect(await db.select('SELECT id FROM practice_responses')).toHaveLength(1));
 await act(async () => { await Promise.resolve(); });
}
function history(route: string) {
 return render(wrap(h(Routes, null, h(Route, { path: '/study/history/:historyKey', element: h(PracticeHistory) })), route));
}
async function openErase() {
 fireEvent.click(await screen.findByRole('button', { name: 'Erase practice history' }));
 return screen.findByRole('button', { name: 'Erase history' });
}

describe('Codex PR2 review: actual UI and disposable persisted state', () => {
 it('[R1] feedback is withheld until the response save is confirmed', async () => {
  const test = await seed('feedback');
  await panel(test);
  const save = repos.practiceSessions.saveSessionAction.bind(repos.practiceSessions);
  const gate = deferred<void>();
  vi.spyOn(repos.practiceSessions, 'saveSessionAction').mockImplementation(async action => {
   if (action.action === 'record_response') await gate.promise;
   return save(action);
  });
  fireEvent.click(screen.getAllByRole('radio')[0]!);
  await act(async () => { await Promise.resolve(); });
  const prematureFeedback = screen.queryByRole('region', { name: 'Question result' }) !== null;
  gate.resolve();
  await waitFor(async () => expect(await db.select('SELECT id FROM practice_responses')).toHaveLength(1));
  expect(prematureFeedback).toBe(false);
 });

 it('[R2] Continue is disabled while a mutation outcome is unknown', async () => {
  const test = await seed('pending');
  await panel(test);
  const save = repos.practiceSessions.saveSessionAction.bind(repos.practiceSessions);
  const gate = deferred<void>();
  vi.spyOn(repos.practiceSessions, 'saveSessionAction').mockImplementation(async action => {
   if (action.action === 'record_response') await gate.promise;
   return save(action);
  });
  fireEvent.click(screen.getAllByRole('radio')[0]!);
  await act(async () => { await Promise.resolve(); });
  const canContinue = !screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled');
  gate.resolve();
  await waitFor(async () => expect(await db.select('SELECT id FROM practice_responses')).toHaveLength(1));
  expect(canContinue).toBe(false);
 });

 it('[R1] a failed completion exposes retry and does not claim completion', async () => {
  await panel(await seed('complete-failure'));
  await answerConfirmed();
  vi.spyOn(repos.practiceSessions, 'saveSessionAction').mockRejectedValue(new Error('Synthetic completion refusal'));
  fireEvent.click(screen.getByRole('button', { name: /Complete test now/ }));
  await act(async () => { await Promise.resolve(); });
  const saved = await repos.practiceSessions.getCurrentAttempt('complete-failure');
  expect({ completedVisible: !!screen.queryByText('Practice test complete'), retryVisible: !!screen.queryByRole('button', { name: 'Retry' }), storedStatus: saved?.status }).toEqual({ completedVisible: false, retryVisible: true, storedStatus: 'in_progress' });
 });

 it('[R2] a successful refresh retry clears the refresh failure and unlocks editing', async () => {
  await panel(await seed('refresh'));
  const read = createRepositories(db).practiceSessions.getCurrentAttempt;
  let failNext = false;
  vi.spyOn(repos.practiceSessions, 'getCurrentAttempt').mockImplementation(async id => {
   if (failNext) { failNext = false; throw Error('Synthetic read failure'); }
   return read(id);
  });
  const save = repos.practiceSessions.saveSessionAction.bind(repos.practiceSessions);
  vi.spyOn(repos.practiceSessions, 'saveSessionAction').mockImplementation(async action => {
   const result = await save(action);
   if (action.action === 'record_response') failNext = true;
   return result;
  });
  fireEvent.click(screen.getAllByRole('radio')[0]!);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry refresh' }));
  await act(async () => { await Promise.resolve(); });
  expect({ errorRemains: !!screen.queryByText(/refreshing status failed/), changeDisabled: screen.getByRole('button', { name: 'Change answer' }).hasAttribute('disabled') }).toEqual({ errorRemains: false, changeDisabled: false });
 });

 it('[R1] a repository read failure cannot expose editable volatile practice', async () => {
  const test = await seed('read-failure');
  vi.spyOn(repos.practiceSessions, 'getActiveVersion').mockRejectedValue(Error('Synthetic initial read failure'));
  render(wrap(h(PracticeTestPanel, { practiceTest: test })));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryAllByRole('radio').some(r => !r.hasAttribute('disabled'))).toBe(false);
 });

 it('[R1] displayed questions come from the frozen repository version', async () => {
  const stale = await seed('frozen');
  await repos.documents.savePracticeTest({ sourceMaterialId: 'frozen', title: 'New version', model: 'synthetic', questions: [
   { question: 'Current frozen version question', options: ['Current A', 'Current B'], correctIndex: 1, explanation: 'Current explanation', sourcePage: null },
  ] });
  await panel(stale);
  expect(screen.queryByText('Current frozen version question')).not.toBeNull();
 });

 it('[R3] a late material A load cannot bind material B answers to A', async () => {
  const a = await seed('route-A');
  const b = await seed('route-B');
  await start('route-A');
  const activeRead = repos.practiceSessions.getActiveVersion.bind(repos.practiceSessions);
  const gate = deferred<Awaited<ReturnType<typeof activeRead>>>();
  vi.spyOn(repos.practiceSessions, 'getActiveVersion').mockImplementation(id => id === 'route-A' ? gate.promise : activeRead(id));
  const currentRead = vi.spyOn(repos.practiceSessions, 'getCurrentAttempt');
  const view = render(wrap(h(PracticeTestPanel, { practiceTest: a })));
  view.rerender(wrap(h(PracticeTestPanel, { practiceTest: b })));
  await waitFor(() => expect(currentRead).toHaveBeenCalledWith('route-B'));
  gate.resolve(await activeRead('route-A'));
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getAllByRole('radio')[0]!);
  await waitFor(async () => expect(await db.select('SELECT id FROM practice_responses')).toHaveLength(1));
  const result = await db.select<{ source_material_id: string }>('SELECT a.source_material_id FROM practice_responses r JOIN practice_attempts a ON r.attempt_id=a.id');
  expect(result).toEqual([{ source_material_id: 'route-B' }]);
 });

 it('[R3] late group A results cannot label group B destructive confirmation', async () => {
  await seed('history-A'); await seed('history-B');
  await complete('history-A'); await complete('history-B');
  const read = repos.practiceSessions.getCompletedHistory.bind(repos.practiceSessions);
  const gate = deferred<Awaited<ReturnType<typeof read>>>();
  vi.spyOn(repos.practiceSessions, 'getCompletedHistory').mockImplementation(key => key === 'history-A' ? gate.promise : read(key));
  render(wrap(h('div', null, h(Link, { to: '/study/history/history-B' }, 'Switch group'), h(Routes, null, h(Route, { path: '/study/history/:historyKey', element: h(PracticeHistory) }))), '/study/history/history-A'));
  fireEvent.click(screen.getByRole('link', { name: 'Switch group' }));
  await screen.findByRole('heading', { name: 'Material history-B' });
  gate.resolve(await read('history-A'));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByRole('heading', { name: 'Material history-B' })).not.toBeNull();
 });

 it('[R4] lost erase acknowledgement retries the same identity and preserves later progress', async () => {
  await seed('erase-retry'); await complete('erase-retry');
  const erase = repos.practiceSessions.eraseHistory.bind(repos.practiceSessions);
  const identities: string[] = [];
  let first = true;
  vi.spyOn(repos.practiceSessions, 'eraseHistory').mockImplementation(async action => {
   identities.push(action.operationId);
   const result = await erase(action);
   if (first) { first = false; await start('erase-retry'); throw Error('Synthetic lost erase acknowledgement'); }
   return result;
  });
  history('/study/history/erase-retry');
  const confirm = await openErase();
  fireEvent.click(confirm);
  await screen.findByText('Synthetic lost erase acknowledgement');
  fireEvent.click(screen.getByRole('button', { name: 'Erase history' }));
  await waitFor(() => expect(identities).toHaveLength(2));
  await act(async () => { await Promise.resolve(); });
  const remaining = await db.select('SELECT id FROM practice_attempts');
  expect({ sameOperation: identities[0] === identities[1], remainingAttempts: remaining.length }).toEqual({ sameOperation: true, remainingAttempts: 1 });
 });

 it('[control] same-identity erasure replay preserves a newly started attempt', async () => {
  await seed('erase-control'); await complete('erase-control');
  const action = { action: 'erase_history' as const, operationId: crypto.randomUUID(), historyKey: 'erase-control' };
  await repos.practiceSessions.eraseHistory(action);
  await start('erase-control');
  await repos.practiceSessions.eraseHistory(action);
  expect(await db.select('SELECT id FROM practice_attempts')).toHaveLength(1);
 });
});
