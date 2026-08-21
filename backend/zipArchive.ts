import { Buffer } from "node:buffer";

export type ZipArchiveEntry = {
  name: string;
  body: Uint8Array;
};

export type StoredZipWriter = {
  append(entry: ZipArchiveEntry): Promise<void>;
  finish(): Promise<void>;
};

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(body: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of body) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

// Keeps only the ZIP directory in memory, so large ticket batches do not need a second full-size buffer.
export function createStoredZipWriter(write: (chunk: Buffer) => Promise<void>): StoredZipWriter {
  const centralParts: Buffer[] = [];
  let entryCount = 0;
  let localOffset = 0;
  return {
    async append(entry) {
      if (entryCount >= 0xffff) throw new Error("Too many ZIP entries");
      const name = Buffer.from(entry.name, "utf8");
      const body = Buffer.from(entry.body);
      if (name.length > 0xffff) throw new Error("ZIP entry name is too long");
      if (body.length > 0xffffffff || localOffset > 0xffffffff) throw new Error("ZIP archive is too large");
      const checksum = crc32(body);
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0); localHeader.writeUInt16LE(20, 4); localHeader.writeUInt16LE(0x800, 6);
      localHeader.writeUInt32LE(checksum, 14); localHeader.writeUInt32LE(body.length, 18); localHeader.writeUInt32LE(body.length, 22);
      localHeader.writeUInt16LE(name.length, 26);
      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0); centralHeader.writeUInt16LE(20, 4); centralHeader.writeUInt16LE(20, 6); centralHeader.writeUInt16LE(0x800, 8);
      centralHeader.writeUInt32LE(checksum, 16); centralHeader.writeUInt32LE(body.length, 20); centralHeader.writeUInt32LE(body.length, 24);
      centralHeader.writeUInt16LE(name.length, 28); centralHeader.writeUInt32LE(localOffset, 42);
      await write(localHeader); await write(name); await write(body);
      centralParts.push(centralHeader, name);
      localOffset += localHeader.length + name.length + body.length;
      entryCount += 1;
    },
    async finish() {
      const centralDirectory = Buffer.concat(centralParts);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entryCount, 8); end.writeUInt16LE(entryCount, 10);
      end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(localOffset, 16);
      await write(centralDirectory); await write(end);
    },
  };
}

// ponytail: stored entries are enough because PNG and PDF assets are already compressed.
export function buildStoredZipArchive(entries: ZipArchiveEntry[]) {
  if (entries.length > 0xffff) throw new Error("Too many ZIP entries");

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const body = Buffer.from(entry.body);
    if (name.length > 0xffff) throw new Error("ZIP entry name is too long");
    if (body.length > 0xffffffff || localOffset > 0xffffffff) {
      throw new Error("ZIP archive is too large");
    }

    const checksum = crc32(body);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(body.length, 18);
    localHeader.writeUInt32LE(body.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, body);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(body.length, 20);
    centralHeader.writeUInt32LE(body.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);

    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + body.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}
