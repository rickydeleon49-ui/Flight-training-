const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Synthetic in-memory dependency probe. No app storage, adapter or user database.
async function main() {
  const repo = process.argv[2];
  if (!repo) throw new Error('Repository path required');
  const dependency = path.join(repo, 'node_modules/sql.js');
  const installedVersion = require(path.join(dependency, 'package.json')).version;
  const lockedVersion = JSON.parse(fs.readFileSync(path.join(repo, 'package-lock.json'), 'utf8'))
    .packages['node_modules/sql.js'].version;
  assert.equal(installedVersion, lockedVersion);
  const SQL = await require(dependency)({ locateFile: name => path.join(dependency, 'dist', name) });
  const scalar = (db, sql) => db.exec(sql)[0].values[0][0];
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  db.run('CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE); INSERT INTO parent VALUES(1); INSERT INTO child VALUES(1,1)');
  const beforeSnapshot = scalar(db, 'PRAGMA foreign_keys');
  const snapshot = db.export();
  const afterSnapshot = scalar(db, 'PRAGMA foreign_keys');
  db.run('BEGIN IMMEDIATE');
  db.run('INSERT INTO child VALUES(2,999)');
  db.run('COMMIT');
  const orphanAccepted = scalar(db, 'SELECT COUNT(*) FROM child WHERE parent_id=999') === 1;
  db.run('DELETE FROM parent WHERE id=1');
  const cascadeMissed = scalar(db, 'SELECT COUNT(*) FROM child WHERE id=1') === 1;
  db.close();

  const recovered = new SQL.Database(snapshot);
  const afterRecovery = scalar(recovered, 'PRAGMA foreign_keys');
  const originalRowsPreserved = scalar(recovered, 'SELECT COUNT(*) FROM child') === 1;
  recovered.run('PRAGMA foreign_keys = ON');
  const afterReinitialize = scalar(recovered, 'PRAGMA foreign_keys');
  let orphanRejectedAfterReinitialize = false;
  try { recovered.run('INSERT INTO child VALUES(2,999)'); }
  catch (error) { orphanRejectedAfterReinitialize = /FOREIGN KEY/.test(String(error)); }
  recovered.run('DELETE FROM parent WHERE id=1');
  const cascadeWorksAfterReinitialize = scalar(recovered, 'SELECT COUNT(*) FROM child') === 0;
  recovered.export();
  const afterDurableExport = scalar(recovered, 'PRAGMA foreign_keys');
  recovered.close();

  const observations = {
    installedVersion, lockedVersion, beforeSnapshot, afterSnapshot, orphanAccepted,
    cascadeMissed, afterRecovery, originalRowsPreserved, afterReinitialize,
    orphanRejectedAfterReinitialize, cascadeWorksAfterReinitialize, afterDurableExport,
  };
  assert.deepEqual(observations, {
    installedVersion: '1.14.2', lockedVersion: '1.14.2', beforeSnapshot: 1,
    afterSnapshot: 0, orphanAccepted: true, cascadeMissed: true, afterRecovery: 0,
    originalRowsPreserved: true, afterReinitialize: 1,
    orphanRejectedAfterReinitialize: true, cascadeWorksAfterReinitialize: true,
    afterDurableExport: 0,
  });
  console.log(JSON.stringify({ probe: 'Dependency lifecycle diagnostic, not Slice B implementation', result: 'observations confirmed', observations }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
