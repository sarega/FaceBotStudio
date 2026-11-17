import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { detectPaidProofImage, optimizePaidProofImage } from "./paidProofImage";

test("lossless screenshot compression preserves visible pixels and image format", async () => {
  const image = await sharp({ create: { width: 1100, height: 900, channels: 3, background: "#ffffff" } })
    .png({ compressionLevel: 0 }).toBuffer();
  assert.equal(await detectPaidProofImage(image), "image/png");
  const optimized = await optimizePaidProofImage(image, "image/png");
  assert.ok(optimized.content.length < image.length);
  assert.equal(optimized.mime, "image/webp");
  assert.equal(await detectPaidProofImage(optimized.content), "image/webp");
  const pixels = await sharp(optimized.content).raw().toBuffer({ resolveWithObject: true });
  assert.equal(pixels.info.width, 1100);
  assert.equal(pixels.info.height, 900);
  assert.ok(pixels.data.every(value => value === 255));
});

test("small proof images are never enlarged by optimization", async () => {
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const result = await optimizePaidProofImage(image, "image/png");
  assert.ok(result.content.length <= image.length);
  assert.equal(await detectPaidProofImage(result.content), result.mime);
});
