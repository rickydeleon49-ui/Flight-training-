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

// Only path d, points and transform attributes get shorter numbers.
function shortenNumbers(markup) {
  return markup.replace(/(\s(?:d|points|transform)=)(["'])([^"']*)\2/g, (_m, pre, q, value) =>
    pre + q + value.replace(/\d+\.\d{3,}/g, shortNumber) + q,
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
  return out.trim() + "\n";
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
