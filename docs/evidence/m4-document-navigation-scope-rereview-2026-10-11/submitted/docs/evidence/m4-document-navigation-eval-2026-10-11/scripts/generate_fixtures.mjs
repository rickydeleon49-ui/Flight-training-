/**
 * Synthetic PDF generator for Her Flight Deck M4 evaluation.
 * Creates deterministic, valid PDF-1.4 byte files with correct xref tables,
 * page counts, and text markers, plus a corrupted fixture.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function buildPdf(pageCount, titlePrefix = "Synthetic Page") {
  const objects = [];

  // Object 1: Catalog
  objects.push({ id: 1, body: `<< /Type /Catalog /Pages 2 0 R >>` });

  // Object 2: Pages container (kids defined below)
  const pageObjectIds = [];
  for (let i = 0; i < pageCount; i++) {
    pageObjectIds.push(3 + i * 2);
  }
  const kidsStr = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
  objects.push({ id: 2, body: `<< /Type /Pages /Kids [${kidsStr}] /Count ${pageCount} >>` });

  // Create Page and Contents objects
  for (let i = 0; i < pageCount; i++) {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    const pageText = `${titlePrefix} ${i + 1} of ${pageCount}`;
    const streamContent = `BT\n/Helvetica 12 Tf\n72 720 Td\n(${pageText}) Tj\nET`;
    const streamLen = Buffer.byteLength(streamContent, "utf-8");

    objects.push({
      id: pageId,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /Helvetica << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${contentId} 0 R >>`,
    });

    objects.push({
      id: contentId,
      body: `<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream`,
    });
  }

  // Assemble PDF bytes with exact xref table
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];

  for (const obj of objects) {
    offsets[obj.id] = Buffer.byteLength(out, "latin1");
    out += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
  }

  const startXref = Buffer.byteLength(out, "latin1");
  const totalObjects = objects.length + 1;
  out += `xref\n0 ${totalObjects}\n0000000000 65535 f \n`;

  for (let i = 1; i < totalObjects; i++) {
    const offsetStr = String(offsets[i]).padStart(10, "0");
    out += `${offsetStr} 00000 n \n`;
  }

  out += `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function buildMalformedPdf() {
  return Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 999 0 R >>\nendobj\nxref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n99999\n%%EOF_CORRUPT\n", "latin1");
}

const targetDir = path.resolve("docs/evidence/m4-document-navigation-eval-2026-10-11/fixtures");
fs.mkdirSync(targetDir, { recursive: true });

const fixtures = [
  { name: "single_page.pdf", pages: 1, desc: "Single-page minimal valid PDF", buffer: buildPdf(1, "Single Page Document") },
  { name: "multi_page_sample.pdf", pages: 10, desc: "10-page study document with consecutive pages", buffer: buildPdf(10, "Aviation Weather Advisory Page") },
  { name: "handbook_root_sample.pdf", pages: 50, desc: "50-page root handbook simulation (e.g. PHAK chapter 1-5)", buffer: buildPdf(50, "FAA Handbook Master Page") },
  { name: "split_part_sample.pdf", pages: 16, desc: "16-page split part (corresponding to root pages 10..25)", buffer: buildPdf(16, "Handbook Split Chapter 2 Page") },
  { name: "malformed_sample.pdf", pages: 0, desc: "Corrupted PDF with broken xref and missing object", buffer: buildMalformedPdf() },
];

const manifest = [];

for (const fix of fixtures) {
  const filePath = path.join(targetDir, fix.name);
  fs.writeFileSync(filePath, fix.buffer);
  const sha256 = crypto.createHash("sha256").update(fix.buffer).digest("hex");
  manifest.push({
    file: fix.name,
    pages: fix.pages,
    bytes: fix.buffer.length,
    sha256,
    description: fix.desc,
  });
}

fs.writeFileSync(path.join(targetDir, "fixtures-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Generated ${fixtures.length} fixtures in ${targetDir}`);
