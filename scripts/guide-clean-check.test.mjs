import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRun, score } from './guide-clean-check.mjs';

const good = () => ({
  model: 'claude-sonnet-5-5', summary: '',
  sections: [{ heading: 'Guide', body: '### Lift\n- Wings make lift.' }],
  flashcards: [{ front: 'What is drag?', back: 'Resistance to motion.', sourcePage: 2 }],
  test: [{ question: 'Q?', options: ['a', 'b', 'c'], correct: 1, explanation: 'Because.', source_page: 2, model: 'x' }],
});

test('a clean kit has no findings', () => {
  assert.deepEqual(checkRun(good()), []);
  assert.equal(score([]), 100);
});

test('flags missing parts, preamble, prompt leaks and markdown noise', () => {
  const r = good();
  r.sections[0].body = 'Here is your guide. **bold** and per the instructions, 6-10 topics';
  r.test = [];
  const names = checkRun(r).map((f) => f.check);
  for (const n of ['test-present', 'no-preamble', 'no-prompt-leak', 'no-markdown-leak']) assert.ok(names.includes(n), n);
});

test('flags bad structure in cards and questions', () => {
  const r = good();
  r.flashcards = [{ front: 'What is drag?', back: 'What is drag: friction', sourcePage: 0 }];
  r.test[0] = { question: 'Q?', options: ['a', 'a'], correct: 5, explanation: '', source_page: null };
  const names = checkRun(r).map((f) => f.check);
  for (const n of ['card-page', 'card-no-echo', 'test-options', 'test-correct', 'test-explanation', 'test-page']) assert.ok(names.includes(n), n);
});
