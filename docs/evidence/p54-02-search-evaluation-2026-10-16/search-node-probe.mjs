import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import MiniSearch from './package/dist/es/index.js';
const require = createRequire(path.join(process.argv[3], 'package.json'));
const initSqlJs = require('sql.js');
const mode = process.argv[2], corpusFile = process.argv[4];
if (mode === 'capability') {
  const SQL = await initSqlJs({ locateFile: name => require.resolve(`sql.js/dist/${name}`) });
  const db = new SQL.Database();
  let fts5 = true, fts5Error = null;
  try { db.run('CREATE VIRTUAL TABLE probe USING fts5(body)'); } catch (error) { fts5 = false; fts5Error = String(error.message); }
  const options = db.exec('PRAGMA compile_options')[0].values.flat();
  console.log(JSON.stringify({ runtime: 'actual committed sql.js WASM under Node; not WKWebView', sqliteVersion: db.exec('SELECT sqlite_version()')[0].values[0][0], fts5, fts5Error, compileOptions: options }, null, 2));
  db.close();
} else {
  assert.equal(mode, 'mini');
  const loadStart = performance.now();
  const docs = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
  const loadMs = performance.now() - loadStart;
  global.gc?.();
  const before = process.memoryUsage();
  const index = new MiniSearch({ fields: ['title', 'body'], storeFields: ['title', 'body', 'materialId', 'physicalPage', 'contentSha256'] });
  const begin = performance.now(); index.addAll(docs); const coldIndexMs = performance.now() - begin;
  global.gc?.(); const after = process.memoryUsage();
  const queries = ['crosswind', 'density altitude', 'metar', 'café', 'cafe'];
  const search = [];
  for (const query of queries) {
    const samples = []; let hits = 0, lastIds = [];
    for (let repetition = 0; repetition < 15; repetition++) {
      const start = performance.now(); const result = index.search(query, { combineWith: 'AND' });
      samples.push(performance.now() - start); hits = result.length; lastIds = result.map(hit => hit.id);
    }
    search.push({ query, hits, idsSha256: crypto.createHash('sha256').update(lastIds.sort().join('\n')).digest('hex'), samplesMs: samples });
  }
  const prefixStart = performance.now(); const prefix = index.search('crossw', { prefix: true }); const prefixMs = performance.now() - prefixStart;
  const fuzzyStart = performance.now(); const fuzzy = index.search('crosswnd', { fuzzy: 0.2 }); const fuzzyMs = performance.now() - fuzzyStart;
  assert.equal(index.search('uniqueoldmarker').length, 1);
  const original = docs[0], changed = { ...original, title: 'Changed synthetic', body: 'uniquenewmarker', contentSha256: 'b'.repeat(64) };
  index.replace(changed);
  assert.equal(index.search('uniqueoldmarker').length, 0);
  assert.equal(index.search('uniquenewmarker')[0].contentSha256, changed.contentSha256);
  index.discard(original.id); assert.equal(index.search('uniquenewmarker').length, 0);
  index.add(original); assert.equal(index.search('uniqueoldmarker').length, 1);
  const serialized = JSON.stringify(index);
  const restored = MiniSearch.loadJSON(serialized, { fields: ['title', 'body'], storeFields: ['title', 'body', 'materialId', 'physicalPage', 'contentSha256'] });
  assert.equal(restored.search('uniqueoldmarker').length, 1);
  console.log(JSON.stringify({ engine: 'MiniSearch7.2.0', node: process.version, platform: `${os.platform()}-${os.arch()}`, records: docs.length, corpusLoadMs: loadMs, coldIndexMs, heapBefore: before.heapUsed, heapAfter: after.heapUsed, heapDeltaBytes: after.heapUsed - before.heapUsed, serializedBytes: Buffer.byteLength(serialized), search, prefix: { query: 'crossw', hits: prefix.length, ms: prefixMs }, fuzzy: { query: 'crosswnd', hits: fuzzy.length, ms: fuzzyMs }, updateDeleteRestoreProof: true }, null, 2));
}
