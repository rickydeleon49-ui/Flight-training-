#!/usr/bin/env node
// Shrinks the shipped diagram SVGs. No dependencies. Safe to run again.
// Usage: node scripts/minify-diagrams.mjs [--check]
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets", "diagrams");
const check = process.argv.includes("--check");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".svg")) out.push(p);
  }
  return out;
}

const shortNumber = (n) => {
  const s = Number(n).toFixed(2).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};

// Geometry attributes (path d, points, transform and plain coordinates/sizes) get shorter numbers.
// Trailing ".0" goes too. Text, style and CSS content is never touched here.
const GEOMETRY = "d|points|transform|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|viewBox|stroke-width|stroke-dasharray|fill-opacity|opacity";
function shortenNumbers(markup) {
  const re = new RegExp(`(\\s(?:${GEOMETRY})=)(["'])([^"']*)\\2`, "g");
  return markup.replace(re, (_m, pre, q, value) =>
    pre + q + value.replace(/\d+\.\d+/g, (n) => shortNumber(n)) + q,
  );
}

export function minify(svg) {
  // Text, title, desc and style content stays exactly as written.
  const keep = /<(text|tspan|title|desc|style)\b[^>]*>[\s\S]*?<\/\1>/g;
  const parts = [];
  let last = 0;
  let m;
  const pieces = [];
  while ((m = keep.exec(svg))) {
    pieces.push({ markup: svg.slice(last, m.index), protect: false });
    pieces.push({ markup: m[0], protect: true });
    last = m.index + m[0].length;
  }
  pieces.push({ markup: svg.slice(last), protect: false });
  for (const piece of pieces) {
    if (piece.protect) {
      // Attributes on the opening tag can still be tidied; the content cannot.
      const open = piece.markup.match(/^<[^>]*>/)[0];
      parts.push(shortenNumbers(open) + piece.markup.slice(open.length));
    } else {
      let stripped = piece.markup;
      for (let prev = ""; prev !== stripped; ) {
        prev = stripped;
        stripped = stripped.replace(/<!--[\s\S]*?-->/g, "");
      }
      parts.push(shortenNumbers(stripped));
    }
  }
  let out = parts.join("");
  // Whitespace between tags goes, except where a protected block touches text.
  out = out.replace(/>[ \t\r\n]+</g, (all, offset) => {
    return isInsideProtected(out, offset) ? all : "><";
  });
  return hoistStyles(out.trim()) + "\n";
}

// Repeated inline style="..." values become one class each (appended last in the file's own
// <style>, so same-specificity rules still lose to them just like they lost to inline styles).
function hoistStyles(svg) {
  const lastClose = svg.lastIndexOf("</style>");
  if (lastClose === -1) return svg;
  const tag = /<(text|path|rect|circle|ellipse|polygon|g)\b([^>]*?)(\/?)>/g;
  const counts = new Map();
  for (const m of svg.matchAll(tag)) {
    const st = m[2].match(/\sstyle="([^"]*)"/);
    if (st) counts.set(st[1], (counts.get(st[1]) || 0) + 1);
  }
  const names = new Map();
  let rules = "";
  const existing = new Set(svg.match(/\bq\d+\b/g) || []);
  let i = 0;
  for (const [value, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const name = () => { while (existing.has("q" + i)) i += 1; return "q" + i; };
    const cls = name();
    // Saved per use: ` style="V"` -> ` q1` (when a class attr exists) or ` class="q1"`.
    const saved = n * (` style="${value}"`.length - ` class="${cls}"`.length);
    const cost = `.${cls}{${value}}`.length;
    if (saved <= cost + 8) continue;
    existing.add(cls);
    names.set(value, cls);
    rules += `.${cls}{${value}}`;
  }
  if (!names.size) return svg;
  const body = svg.replace(tag, (all, el, attrs, slash) => {
    const st = attrs.match(/\sstyle="([^"]*)"/);
    if (!st || !names.has(st[1])) return all;
    const cls = names.get(st[1]);
    let rest = attrs.replace(st[0], "");
    const c = rest.match(/\sclass="([^"]*)"/);
    rest = c ? rest.replace(c[0], ` class="${c[1]} ${cls}"`) : rest + ` class="${cls}"`;
    return `<${el}${rest}${slash}>`;
  });
  const close = body.lastIndexOf("</style>");
  return body.slice(0, close) + rules + body.slice(close);
}

// True when the offset sits inside a <text>...</text> block (whitespace between tspans matters).
function isInsideProtected(s, offset) {
  const open = s.lastIndexOf("<text", offset);
  if (open === -1) return false;
  const close = s.lastIndexOf("</text>", offset);
  return open > close;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let changed = 0;
  let before = 0;
  let after = 0;
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, "utf8");
    const next = minify(src);
    before += Buffer.byteLength(src);
    after += Buffer.byteLength(next);
    if (next !== src) {
      changed += 1;
      if (check) console.log(`would change: ${file}`);
      else writeFileSync(file, next);
    }
  }
  console.log(`${check ? "check" : "minified"}: ${changed} file(s) changed, ${before} -> ${after} bytes`);
  if (check && changed) process.exit(1);
}
