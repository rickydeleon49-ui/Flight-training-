// @vitest-environment jsdom
import { createElement as h } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepositories } from '@/data/repositories';
import { createNodeSqliteDatabase, type TestDatabase } from '@/data/testing/nodeSqliteDb';
import { AppDataProvider } from '@/state/AppDataContext';
import { MaterialDetail } from './MaterialDetail';
import * as geminiService from '@/services/gemini';
import * as documentService from '@/services/documents';

let db: TestDatabase;
vi.mock('@/data', () => ({ getDatabase: () => Promise.resolve(db), isTauri: () => false }));
beforeEach(async () => {
 db = await createNodeSqliteDatabase();
 const repos = createRepositories(db);
 await repos.app.set('airline_starter_pack', 'skipped-for-test');
 await repos.documents.create({ id: 'read-target', title: 'Synthetic read target' });
 await repos.documents.savePracticeTest({ sourceMaterialId: 'read-target', title: 'Saved test', model: 'synthetic', questions: [{ question: 'Saved synthetic question', options: ['A','B'], correctIndex: 0, explanation: 'Synthetic explanation', sourcePage: null }] });
 vi.spyOn(geminiService, 'getGeminiStatus').mockResolvedValue({ configured: false, model: '' });
 vi.spyOn(geminiService, 'watchGeminiProgress').mockResolvedValue(() => {});
 vi.spyOn(documentService, 'canHandleFiles').mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); db.close(); });

describe('Codex MaterialDetail practice metadata read failure', () => {
 for (const target of ['conversion', 'history']) {
  it(`[R14] ${target} rejection has visible practice read recovery`, async () => {
   const read = db.select.bind(db);
   let failedReads = 0;
   vi.spyOn(db, 'select').mockImplementation(async (sql, params) => {
    const match = target === 'conversion' ? sql.includes('SELECT legacy_migrated_at, legacy_error') : sql.includes('SELECT a.id AS attempt_id');
    if (match) { failedReads += 1; throw Error(`Synthetic ${target} metadata read failure`); }
    return read(sql, params);
   });
   render(h(AppDataProvider, null, h(MemoryRouter, { initialEntries: ['/study/read-target'] }, h(Routes, null, h(Route, { path: '/study/:materialId', element: h(MaterialDetail) })))));
   await screen.findByRole('heading', { name: 'Synthetic read target' });
   await waitFor(() => expect(failedReads).toBeGreaterThan(0));
   await act(async () => { await Promise.resolve(); await Promise.resolve(); });
   expect(screen.queryByRole('button', { name: /Retry.*practice/i })).not.toBeNull();
  });
 }
});
