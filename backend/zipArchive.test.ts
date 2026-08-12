import assert from "node:assert/strict";
import test from "node:test";

import { buildStoredZipArchive } from "./zipArchive";

test("builds a UTF-8 stored ZIP archive", () => {
  const archive = buildStoredZipArchive([
    { name: "001-ticket.png", body: Buffer.from("png-bytes") },
    { name: "002-บัตร.pdf", body: Buffer.from("pdf-bytes") },
  ]);
  const endOfCentralDirectory = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.notEqual(endOfCentralDirectory, -1);
  assert.equal(archive.readUInt16LE(endOfCentralDirectory + 10), 2);
  assert.equal(archive.includes(Buffer.from("001-ticket.png")), true);
  assert.equal(archive.includes(Buffer.from("002-บัตร.pdf")), true);
});
