// Synthetic fixtures for the VISUAL-01b developer proof. No dependencies.
// A fictional, non-operational "practice panel" with three labelled parts
// (ALPHA / BRAVO / CHARLIE), plus bad inputs the PNG header guard must refuse.
//   node scripts/make-visual-fixtures.mjs [outDir]
import zlib from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "src/testing/fixtures/visual";
mkdirSync(out, { recursive: true });

const crcTable = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = (w, h) => { const b = Buffer.alloc(13); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 2; return chunk("IHDR", b); };

// 5x7 bitmap glyphs for the letters used.
const FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
};

const W = 480, H = 240;
const rgb = Buffer.alloc(W * H * 3);
const fill = (x0, y0, w, h, [r, g, b]) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * W + x) * 3; rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
  }
};
const text = (s, x0, y0, scale, color) => {
  [...s].forEach((ch, k) => FONT[ch].forEach((row, y) => [...row].forEach((bit, x) => {
    if (bit === "1") fill(x0 + (k * 6 + x) * scale, y0 + y * scale, scale, scale, color);
  })));
};
fill(0, 0, W, H, [250, 244, 236]);
// Three panel parts with leader lines down to their labels.
const parts = [
  { label: "ALPHA", x: 30, color: [120, 160, 200] },
  { label: "BRAVO", x: 180, color: [200, 160, 110] },
  { label: "CHARLIE", x: 330, color: [140, 190, 140] },
];
for (const p of parts) {
  fill(p.x, 30, 120, 90, p.color);
  fill(p.x + 59, 120, 2, 50, [80, 70, 90]);
  const width = (p.label.length * 6 - 1) * 3;
  text(p.label, p.x + 60 - Math.floor(width / 2), 180, 3, [53, 44, 67]);
}
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) rgb.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
const idat = chunk("IDAT", zlib.deflateSync(raw));
const iend = chunk("IEND", Buffer.alloc(0));
const panel = Buffer.concat([SIGNATURE, ihdr(W, H), idat, iend]);

// acTL: num_frames=1, num_plays=0, placed before IDAT as in a real APNG.
const actl = Buffer.alloc(8); actl.writeUInt32BE(1, 0);
// Header bomb: claims 20000 x 20000 but carries one tiny IDAT.
const bomb = Buffer.concat([SIGNATURE, ihdr(20000, 20000), chunk("IDAT", zlib.deflateSync(Buffer.alloc(16))), iend]);
// A JPEG start-of-image and JFIF header saved with a .png name.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9, ...Buffer.alloc(40)]);

const files = {
  "practice-panel.png": panel,
  "bad-header-bomb.png": bomb,
  "bad-truncated.png": panel.subarray(0, 60),
  "bad-animated.png": Buffer.concat([SIGNATURE, ihdr(W, H), chunk("acTL", actl), idat, iend]),
  "bad-jpeg-renamed.png": jpeg,
};
for (const [name, bytes] of Object.entries(files)) writeFileSync(join(out, name), bytes);
console.log(`wrote ${Object.keys(files).length} synthetic fixtures to ${out}`);
