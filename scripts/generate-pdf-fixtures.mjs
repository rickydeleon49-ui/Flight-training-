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

/** DEFLATE packs bits low first, except for Huffman codes. */
class BitWriter {
  constructor() {
    this.bytes = [];
    this.acc = 0;
    this.held = 0;
  }

  writeLow(value, count) {
    this.acc |= value << this.held;
    this.held += count;
    while (this.held >= 8) {
      this.bytes.push(this.acc & 0xff);
      this.acc >>>= 8;
      this.held -= 8;
    }
  }

  writeCode(value, count) {
    for (let i = count - 1; i >= 0; i--) this.writeLow((value >>> i) & 1, 1);
  }

  finish() {
    if (this.held > 0) this.bytes.push(this.acc & 0xff);
    return Buffer.from(this.bytes);
  }
}

/** RFC 1951 fixed Huffman code for a literal/length symbol. */
function fixedCode(symbol) {
  if (symbol <= 143) return [0x30 + symbol, 8];
  if (symbol <= 255) return [0x190 + (symbol - 144), 9];
  if (symbol <= 279) return [symbol - 256, 7];
  return [0xc0 + (symbol - 280), 8];
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];

/** The length code that encodes `length` bytes, and its extra bits. */
function lengthCode(length) {
  for (let i = LENGTH_BASE.length - 1; i >= 0; i--) {
    const extra = LENGTH_EXTRA[i];
    if (length >= LENGTH_BASE[i] && length < LENGTH_BASE[i] + (1 << extra)) {
      return { symbol: 257 + i, extra, value: length - LENGTH_BASE[i] };
    }
  }
  throw new Error("no length code for " + length);
}

/**
 * A zlib stream that decodes to `prefix` followed by `zeroCount` zero bytes.
 *
 * It is written by hand from fixed Huffman codes rather than with
 * `node:zlib`, so the bytes never depend on the zlib build: the fixture's
 * SHA-256 has to be the same on every machine, not just this one.
 */
export function deflateZeros(prefix, zeroCount) {
  const writer = new BitWriter();
  writer.writeLow(1, 1); // BFINAL
  writer.writeLow(1, 2); // BTYPE: fixed Huffman
  for (const byte of prefix) {
    const [code, bits] = fixedCode(byte);
    writer.writeCode(code, bits);
  }
  if (zeroCount > 0) {
    const [code, bits] = fixedCode(0);
    writer.writeCode(code, bits); // one literal, to give the copies a history
    let remaining = zeroCount - 1;
    while (remaining >= 3) {
      const length = Math.min(remaining, 258);
      const { symbol, extra, value } = lengthCode(length);
      const [symbolCode, symbolBits] = fixedCode(symbol);
      writer.writeCode(symbolCode, symbolBits);
      if (extra > 0) writer.writeLow(value, extra);
      writer.writeCode(0, 5); // distance code 0: copy the previous byte
      remaining -= length;
    }
    while (remaining-- > 0) writer.writeCode(code, bits);
  }
  const [endCode, endBits] = fixedCode(256);
  writer.writeCode(endCode, endBits);
  // Adler-32 of the decoded bytes: the prefix as written, then zeroCount
  // zero bytes, which leave the first sum unchanged.
  let s1 = 1;
  let s2 = 0;
  for (const byte of prefix) {
    s1 = (s1 + byte) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  s2 = (s2 + zeroCount * s1) % 65521;
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(((s2 << 16) | s1) >>> 0, 0);
  return Buffer.concat([Buffer.from([0x78, 0x9c]), writer.finish(), tail]);
}

/**
 * Load-time stress: a compressed cross-reference stream with many free
 * entries. It expands before page inspection, exercising the allocator cap
 * rather than the 8 MiB page-content budget. No decoded giant buffer is
 * allocated by this generator.
 */
export function buildXrefPadPdf(freeEntries, docLabel = "document") {
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
  offsets[2] = pos;
  write("2 0 obj\n<< /Type /Pages /Count 1 /Kids [4 0 R] >>\nendobj\n");
  offsets[3] = pos;
  write("3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  offsets[4] = pos;
  write(
    "4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>\nendobj\n"
  );
  const pageText = `Synthetic ${docLabel} - Page 1 of 1 (ID: P0001)`;
  const textStream = `BT /F1 12 Tf 50 750 Td (${pageText}) Tj ET\n`;
  offsets[5] = pos;
  write(
    "5 0 obj\n<< /Length " +
      textStream.length +
      " >>\nstream\n" +
      textStream +
      "endstream\nendobj\n"
  );

  // The cross-reference stream itself is object 6.
  const xrefId = 6;
  const size = xrefId + 1 + freeEntries;
  const xrefOffset = pos;
  const body = Buffer.concat(chunks);
  const rows = [Buffer.from([0, 0, 0, 0, 0, 0xff, 0xff])];
  for (let i = 1; i <= xrefId; i++) {
    const row = Buffer.alloc(7);
    row[0] = 1;
    row.writeUInt32BE(i === xrefId ? xrefOffset : offsets[i], 1);
    rows.push(row);
  }
  const compressed = deflateZeros(Buffer.concat(rows), freeEntries * 7);
  const streamDict =
    "<< /Type /XRef /Size " + size + " /W [1 4 2] /Root 1 0 R /Filter /FlateDecode /Length " + compressed.length + " >>";
  const tail = Buffer.from(
    "\nstartxref\n" + xrefOffset + "\n%%EOF\n",
    "latin1"
  );
  return Buffer.concat([
    body,
    Buffer.from(
      xrefId +
        " 0 obj\n" +
        streamDict +
        "\nstream\n",
      "latin1"
    ),
    compressed,
    Buffer.from("\nendstream\nendobj\n", "latin1"),
    tail,
  ]);
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
  {
    filename: "synthetic-near-cap.pdf",
    pages: 1,
    freeEntries: 38_000_000,
    label: "near-cap",
    expectedBytes: 1676036,
    expectedSha256: "8f4a80561972412da5a2847eb569620d8d4ef6876676f3be205481d379a5f8d3",
  },
  {
    filename: "synthetic-over-cap.pdf",
    pages: 1,
    freeEntries: 150_000_000,
    label: "over-cap",
    expectedBytes: 6614022,
    expectedSha256: "89a874dd7465187c67cf1948347906f70953b554afcf117bc08045a4d9ba41ec",
  },
];

export function generateFixtures(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const results = [];
  for (const spec of FIXTURE_SPECS) {
    const buf = spec.freeEntries === undefined
      ? buildPdf(spec.pages, spec.imgW, spec.imgH, spec.label)
      : buildXrefPadPdf(spec.freeEntries, spec.label);
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
