import type { Size } from './visualCover';
export const PNG_MAX_BYTES = 10 * 1024 * 1024;
const invalid = () => new Error('Please choose a complete, still PNG picture.');
/** Inspect the complete bounded byte buffer before passing it to any image decoder. */
export function inspectPng(bytes: Uint8Array): Size {
  if (bytes.length > PNG_MAX_BYTES) throw new Error('Please choose a PNG smaller than 10 MiB.');
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const name = (p: number) => String.fromCharCode(...bytes.subarray(p, p + 4));
  if (view.getUint32(8) !== 13 || name(12) !== 'IHDR') throw invalid();
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 4_000_000) throw new Error('Please choose a smaller picture: up to 4,096 pixels per side and 4 million pixels total.');
  let idat = false, end = false;
  for (let p = 8; p < bytes.length;) {
    if (p + 12 > bytes.length) throw invalid();
    const length = view.getUint32(p), type = name(p + 4);
    if (length > bytes.length - p - 12) throw invalid();
    if (type === 'acTL') throw new Error('Please choose a still PNG instead of an animated picture.');
    if (type === 'IDAT') idat = true;
    if (type === 'IEND') { if (length !== 0 || p + 12 !== bytes.length) throw invalid(); end = true; break; }
    p += length + 12;
  }
  if (!idat || !end) throw invalid();
  return { width, height };
}
export async function readProofPng(file: File): Promise<Size & { url: string }> {
  if (file.size > PNG_MAX_BYTES) throw new Error('Please choose a PNG smaller than 10 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = inspectPng(bytes);
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('This picture could not be read. Please try another PNG.'));
    reader.readAsDataURL(new Blob([bytes], { type: "image/png" }));
  });
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => { const ok = image.naturalWidth === size.width && image.naturalHeight === size.height; image.src = ''; ok ? resolve() : reject(invalid()); };
    image.onerror = () => { image.src = ''; reject(invalid()); };
    image.src = url;
  });
  return { ...size, url };
}
