import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function buildPdf(numPages, imgW = 0, imgH = 0, docLabel = "document") {
  const rasterBytesPerPage = imgW > 0 && imgH > 0 ? imgW * imgH * 3 : 0;
  const chunks = [];
  const offsets = [];
  let pos = 0;

  function write(buf) {
    if (typeof buf === "string") buf = Buffer.from(buf, "latin1");
    chunks.push(buf);
    pos += buf.length;
  }

  write("%PDF-1.5\n%\xFF\xFF\xFF\xFF\n");
  offsets[1] = pos;
  write("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const kids = [];
  for (let i = 0; i < numPages; i++) kids.push((3 + i) + " 0 R");
  offsets[2] = pos;
  write("2 0 obj\n<< /Type /Pages /Count " + numPages + " /Kids [" + kids.join(" ") + "] >>\nendobj\n");

  let nextId = 3 + numPages;
  const fontObjId = nextId++;
  const contentObjIds = [];
  for (let i = 0; i < numPages; i++) contentObjIds.push(nextId++);
  const imageObjIds = [];
  if (rasterBytesPerPage > 0) {
    for (let i = 0; i < numPages; i++) imageObjIds.push(nextId++);
  }

  for (let i = 0; i < numPages; i++) {
    offsets[3 + i] = pos;
    const res =
      "<< /Font << /F1 " +
      fontObjId +
      " 0 R >>" +
      (rasterBytesPerPage > 0 ? " /XObject << /Im0 " + imageObjIds[i] + " 0 R >>" : "") +
      " >>";
    write(
      (3 + i) +
        " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources " +
        res +
        " /Contents " +
        contentObjIds[i] +
        " 0 R >>\nendobj\n"
    );
  }

  offsets[fontObjId] = pos;
  write(fontObjId + " 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

  for (let i = 0; i < numPages; i++) {
    offsets[contentObjIds[i]] = pos;
    const pageNum = i + 1;
    const pageIdText = `Synthetic ${docLabel} - Page ${pageNum} of ${numPages} (ID: P${String(pageNum).padStart(4, "0")})`;
    const textStream =
      rasterBytesPerPage > 0
        ? `q 300 0 0 250 50 450 cm /Im0 Do Q\nBT /F1 12 Tf 50 400 Td (${pageIdText}) Tj ET\n`
        : `BT /F1 12 Tf 50 750 Td (${pageIdText}) Tj ET\n`;
    write(contentObjIds[i] + " 0 obj\n<< /Length " + textStream.length + " >>\nstream\n" + textStream + "endstream\nendobj\n");
  }

  if (rasterBytesPerPage > 0) {
    for (let i = 0; i < numPages; i++) {
      offsets[imageObjIds[i]] = pos;
      const imgBuf = Buffer.alloc(rasterBytesPerPage);
      let state = ((i + 1) * 1103515245 + 12345) >>> 0;
      for (let j = 0; j < rasterBytesPerPage; j += 4) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        imgBuf.writeUInt32LE(state, j);
      }
      write(
        imageObjIds[i] +
          " 0 obj\n<< /Type /XObject /Subtype /Image /Width " +
          imgW +
          " /Height " +
          imgH +
          " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length " +
          rasterBytesPerPage +
          " >>\nstream\n"
      );
      write(imgBuf);
      write("\nendstream\nendobj\n");
    }
  }

  const startxref = pos;
  const total = nextId - 1;
  write("xref\n0 " + (total + 1) + "\n0000000000 65535 f \n");
  for (let i = 1; i <= total; i++) write(String(offsets[i] || 0).padStart(10, "0") + " 00000 n \n");
  write("trailer\n<< /Size " + (total + 1) + " /Root 1 0 R >>\nstartxref\n" + startxref + "\n%%EOF\n");

  return Buffer.concat(chunks);
}

export const FIXTURE_SPECS = [
  {
    filename: "synthetic-small-checklist.pdf",
    pages: 10,
    imgW: 0,
    imgH: 0,
    label: "Checklist",
    expectedBytes: 3360,
    expectedSha256: "f6c593f9d86de6e83bd476897cde7693a43cb5db785c6afbcf01eb1d8024b134",
  },
  {
    filename: "synthetic-long-manual.pdf",
    pages: 1050,
    imgW: 0,
    imgH: 0,
    label: "Handbook",
    expectedBytes: 330934,
    expectedSha256: "0ba9a7e2c4b9e14aac2360fc410f5b4a05eab9b2c9ab4b23ea8ab7228f9692c1",
  },
  {
    filename: "synthetic-illustrated-charts.pdf",
    pages: 60,
    imgW: 600,
    imgH: 500,
    label: "Charts",
    expectedBytes: 54032644,
    expectedSha256: "b5651eb61a484dbe4876da2ff002d4884f414086080ee061b67f6fec01ab096d",
  },
];

export function generateFixtures(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const results = [];
  for (const spec of FIXTURE_SPECS) {
    const buf = buildPdf(spec.pages, spec.imgW, spec.imgH, spec.label);
    const filePath = path.join(targetDir, spec.filename);
    fs.writeFileSync(filePath, buf);
    const hash = crypto.createHash("sha256").update(buf).digest("hex");
    results.push({ filename: spec.filename, filePath, bytes: buf.length, sha256: hash });
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const targetDir = process.argv[2] || process.cwd();
  const generated = generateFixtures(targetDir);
  for (const item of generated) {
    console.log(`${item.filename}: ${item.bytes} bytes, SHA-256: ${item.sha256}`);
  }
}
