#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Input must be a Buffer");
  }
  if (buffer.length < 22) {
    throw new Error("File too small to be a valid ZIP archive");
  }

  // Find End of Central Directory Record (EOCD)
  // EOCD signature is 0x06054b50 (PK\x05\x06)
  // Search backwards from end (comment can be at most 65535 bytes)
  let eocdOffset = -1;
  const maxSearch = Math.min(buffer.length, 65535 + 22);
  for (let i = buffer.length - 22; i >= buffer.length - maxSearch; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("End of Central Directory record not found");
  }

  const commentLen = buffer.readUInt16LE(eocdOffset + 20);
  if (eocdOffset + 22 + commentLen !== buffer.length) {
    throw new Error("Malformed EOCD bounds or trailing data");
  }

  const diskNum = buffer.readUInt16LE(eocdOffset + 4);
  const startDisk = buffer.readUInt16LE(eocdOffset + 6);
  const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  if (diskNum !== 0 || startDisk !== 0 || diskEntries !== totalEntries) {
    throw new Error("Multi-disk ZIP archives are not supported");
  }

  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported");
  }
  if (eocdOffset >= 20 && buffer.readUInt32LE(eocdOffset - 20) === 0x07064b50) {
    throw new Error("ZIP64 archives are not supported");
  }

  if (cdOffset < 0 || cdSize < 0 || cdOffset + cdSize > buffer.length) {
    throw new Error("Invalid central directory offset or size");
  }
  if (cdOffset + cdSize !== eocdOffset) {
    throw new Error("Central directory offset and size do not match EOCD location");
  }

  const entries = [];
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > cdOffset + cdSize) {
      throw new Error("Truncated central directory header");
    }
    const sig = buffer.readUInt32LE(pos);
    if (sig !== 0x02014b50) {
      throw new Error(`Invalid central directory file header signature: 0x${sig.toString(16)}`);
    }

    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const fileCommentLen = buffer.readUInt16LE(pos + 32);
    const localHeaderOffset = buffer.readUInt32LE(pos + 42);

    if (pos + 46 + nameLen + extraLen + fileCommentLen > cdOffset + cdSize) {
      throw new Error("Truncated variable fields in central directory record");
    }

    const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLen);

    // Verify local header consistency
    if (localHeaderOffset + 30 > cdOffset) {
      throw new Error("Invalid local header offset");
    }
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error("Invalid local file header signature");
    }
    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    if (localHeaderOffset + 30 + localNameLen + localExtraLen > cdOffset) {
      throw new Error("Invalid local header bounds");
    }
    const localName = buffer.toString("utf8", localHeaderOffset + 30, localHeaderOffset + 30 + localNameLen);
    if (localName !== name) {
      throw new Error("Central directory entry name does not match local header name");
    }

    entries.push(name);
    pos += 46 + nameLen + extraLen + fileCommentLen;
  }

  if (pos !== cdOffset + cdSize) {
    throw new Error("Central directory size does not match parsed entries");
  }

  return entries;
}

export function inspectBackupArchive(archivePath) {
  try {
    if (!archivePath || typeof archivePath !== "string" || !fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
      return { status: 2, message: "INSPECTION ERROR: archive missing, unreadable, or corrupted" };
    }
    const buf = fs.readFileSync(archivePath);
    const entries = readZipEntries(buf);

    const credentialPattern = /(^|[ /])gemini-key(\.writing)?([ /]|$)/;
    const hasSecretEntry = entries.some((entry) => credentialPattern.test(entry));

    if (hasSecretEntry) {
      return { status: 1, message: "FAIL: credential entry found in archive" };
    }

    return { status: 0, message: "PASS: no credential entry names in archive" };
  } catch (_err) {
    return { status: 2, message: "INSPECTION ERROR: archive missing, unreadable, or corrupted" };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const target = process.argv[2];
  if (!target) {
    console.error("INSPECTION ERROR: archive missing, unreadable, or corrupted");
    process.exit(2);
  }
  const result = inspectBackupArchive(target);
  if (result.status === 0) {
    console.log(result.message);
  } else {
    console.error(result.message);
  }
  process.exit(result.status);
}
