#!/usr/bin/env node
// Offline "cleaner raw output" scorer for exported study-kit runs (BL-23). Makes NO network call.
// Input: run JSON files shaped {run, model, summary, sections:[{heading,body}], flashcards:[{front,back,sourcePage}],
//        test:[{question,options,correct,explanation,source_page}]} (see offline/model-eval-2/out).
// Usage: node scripts/guide-clean-check.mjs out/run*.json   -> table + exit 1 if any run has a FAIL check.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHATTY = /^\s*(sure|certainly|of course|here(?:'s| is| are)|okay|ok,|i['’]ll|let me|great)\b/i;
const LEAK = /\b(as instructed|per the instructions|the prompt|my instructions|system prompt|json schema|output format|word limit|\d+\s*[-–]\s*\d+ (?:topics|bullets|sections)|do not (?:invent|include|add))\b/i;
const MD_NOISE = /(\*\*|__|```|^\s*#{1,2}\s|^\s*#{4,}\s|^\s*>\s|<\/?[a-z][^>]*>)/m;

const allText = (r) => [
  r.summary, ...(r.sections ?? []).flatMap((s) => [s.heading, s.body]),
  ...(r.flashcards ?? []).flatMap((c) => [c.front, c.back]),
  ...(r.test ?? []).flatMap((q) => [q.question, ...(q.options ?? []), q.explanation]),
].filter((t) => typeof t === 'string');

/** Returns [{check, level:'FAIL'|'WARN', detail}] for one run; [] means clean. */
export function checkRun(r) {
  const out = [];
  const add = (check, level, detail) => out.push({ check, level, detail });
  const sections = r.sections ?? [], cards = r.flashcards ?? [], test = r.test ?? [];
  if (!sections.length) add('guide-present', 'FAIL', 'no guide sections');
  if (!cards.length) add('cards-present', 'FAIL', 'no flashcards');
  if (!test.length) add('test-present', 'FAIL', 'no practice questions');
  for (const s of sections) {
    const b = (s.body ?? '').trim();
    if (CHATTY.test(b)) add('no-preamble', 'FAIL', `body opens chatty: "${b.slice(0, 40)}"`);
    if (/^(overview|summary|introduction)\s*:/i.test(b)) add('no-label-preamble', 'WARN', `body starts with a label: "${b.slice(0, 30)}"`);
    if (b.length > 1500 && !/^#{3}\s/m.test(b)) add('has-headings', 'WARN', 'long guide without ### headings');
  }
  for (const t of allText(r)) {
    if (LEAK.test(t)) add('no-prompt-leak', 'FAIL', `prompt-rule text: "${t.match(LEAK)[0]}"`);
    if (MD_NOISE.test(t)) add('no-markdown-leak', 'FAIL', `stray markdown: "${t.match(MD_NOISE)[0].trim().slice(0, 20)}"`);
    if (/\b(undefined|null|NaN)\b|\[object Object\]|TODO|lorem ipsum/i.test(t)) add('no-placeholder', 'FAIL', 'placeholder/undefined text');
  }
  const fronts = new Set();
  for (const [i, c] of cards.entries()) {
    if (!c.front?.trim() || !c.back?.trim()) add('card-complete', 'FAIL', `card ${i + 1} empty side`);
    if (!Number.isInteger(c.sourcePage) || c.sourcePage < 1) add('card-page', 'FAIL', `card ${i + 1} no sourcePage`);
    const key = (c.front ?? '').trim().toLowerCase();
    if (fronts.has(key)) add('card-unique', 'WARN', `duplicate front: card ${i + 1}`);
    fronts.add(key);
    if (c.front && c.back && c.back.toLowerCase().startsWith(c.front.toLowerCase().replace(/\?$/, '').slice(0, 25)))
      add('card-no-echo', 'WARN', `card ${i + 1} answer echoes question`);
  }
  for (const [i, q] of test.entries()) {
    const o = q.options ?? [];
    if (o.length < 3 || o.length > 4) add('test-options', 'FAIL', `question ${i + 1} has ${o.length} options`);
    if (new Set(o.map((x) => String(x).trim().toLowerCase())).size !== o.length) add('test-options', 'FAIL', `question ${i + 1} duplicate options`);
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= o.length) add('test-correct', 'FAIL', `question ${i + 1} correct index invalid`);
    if (!q.explanation?.trim()) add('test-explanation', 'FAIL', `question ${i + 1} no explanation`);
    if (!Number.isInteger(q.source_page) || q.source_page < 1) add('test-page', 'FAIL', `question ${i + 1} no source_page`);
  }
  return out;
}

export const score = (findings) => Math.max(0, 100 - 20 * findings.filter((f) => f.level === 'FAIL').length - 5 * findings.filter((f) => f.level === 'WARN').length);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let bad = false;
  for (const file of process.argv.slice(2)) {
    const r = JSON.parse(readFileSync(file, 'utf8'));
    const f = checkRun(r);
    if (f.some((x) => x.level === 'FAIL')) bad = true;
    console.log(`${file}\t${r.model ?? '?'}\tclean=${score(f)}\tFAIL=${f.filter((x) => x.level === 'FAIL').length}\tWARN=${f.filter((x) => x.level === 'WARN').length}`);
    for (const x of f) console.log(`  ${x.level} ${x.check}: ${x.detail}`);
  }
  process.exit(bad ? 1 : 0);
}
