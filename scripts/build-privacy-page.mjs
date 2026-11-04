#!/usr/bin/env node
// Renders PRIVACY.md into the GitHub Pages site (privacy/index.html plus a
// landing page). PRIVACY.md is the only source; nothing generated is committed.
// Handles only what PRIVACY.md uses: #/##/### headings, paragraphs, "- " lists,
// `code`, **bold** and <https://…> links. No dependencies.
// Usage: node scripts/build-privacy-page.mjs [outDir=_site]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text) {
  return escape(text)
    .replace(/&lt;(https:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function renderPrivacyHtml(markdown) {
  const out = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<ul>\n${list.map((item) => `  <li>${inline(item)}</li>`).join("\n")}\n</ul>`);
    list = null;
  };
  let title = "Privacy policy";
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      if (level === 1) title = heading[2];
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (line.startsWith("- ")) {
      flushParagraph();
      (list ??= []).push(line.slice(2).trim());
    } else if (/^\s+\S/.test(line) && list) {
      list[list.length - 1] += ` ${line.trim()}`;
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
:root { color-scheme: light dark; --fg: #1d2433; --bg: #fbfaf7; --muted: #5a6274; --code: #eef0f3; }
@media (prefers-color-scheme: dark) { :root { --fg: #e7e9ee; --bg: #14181f; --muted: #a3aab8; --code: #232a35; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 42rem; margin: 0 auto; padding: 2rem 16px 4rem; }
h1 { font-size: 1.8rem; line-height: 1.2; } h2 { margin-top: 2.2rem; font-size: 1.3rem; } h3 { font-size: 1.05rem; }
code { background: var(--code); padding: 0 .25em; border-radius: 4px; font-size: .9em; overflow-wrap: anywhere; }
a { color: inherit; overflow-wrap: anywhere; }
</style>
</head>
<body>
<main>
${out.join("\n")}
</main>
</body>
</html>
`;
}

export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0; url=privacy/">
<title>Your Flight Deck</title>
</head>
<body><p><a href="privacy/">Your Flight Deck privacy policy</a></p></body>
</html>
`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = resolve(process.argv[2] ?? join(root, "_site"));
  mkdirSync(join(outDir, "privacy"), { recursive: true });
  writeFileSync(join(outDir, "privacy", "index.html"), renderPrivacyHtml(readFileSync(join(root, "PRIVACY.md"), "utf8")));
  writeFileSync(join(outDir, "index.html"), LANDING_HTML);
  console.log(`Privacy page written to ${outDir}`);
}
