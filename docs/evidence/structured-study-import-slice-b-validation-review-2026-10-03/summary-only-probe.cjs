// Runs accepted pure Slice A code with synthetic input; no app/profile/storage.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = process.argv[2];
if (!repo) throw new Error('Repository path required');
const ts = require(path.join(repo, 'node_modules/typescript'));
require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};
const { validatePacketText } = require(path.join(repo, 'src/logic/studyPacket/index.ts'));
const result = validatePacketText(JSON.stringify({
  format: 'hfd-study-packet', formatVersion: 1, title: 'Synthetic summary only',
  guide: { summary: 'Invented training labels for a disposable diagnostic.' },
}));
assert.equal(result.ok, true);
const { studySet, practiceTest } = result.payload;
assert.ok(studySet.summary.length > 0);
assert.equal(studySet.sections.length, 0);
assert.equal(studySet.flashcards.length, 0);
assert.equal(practiceTest, null);
const acceptedSubstantiveRule = Boolean(studySet.summary || studySet.sections.length || studySet.flashcards.length);
const submittedProposedRule = Boolean(studySet.sections.length || studySet.flashcards.length);
assert.equal(acceptedSubstantiveRule, true);
assert.equal(submittedProposedRule, false);
console.log(JSON.stringify({
  kind: 'Synthetic accepted-validator diagnostic, not Slice B implementation test',
  sliceAValidationAccepted: result.ok,
  hasNonemptySummary: studySet.summary.length > 0,
  sectionCount: studySet.sections.length,
  flashcardCount: studySet.flashcards.length,
  practiceTest: null,
  acceptedSubstantiveRule,
  submittedProposedRule,
}, null, 2));
