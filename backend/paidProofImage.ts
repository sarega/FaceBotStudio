import sharp from "sharp";
import type { PaidProofInput } from "./db/paidRegistration";

const mimeTypes = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;
const maxPixels = 24_000_000;

// Decode the full raster before accepting evidence. Metadata alone cannot detect corrupt image data.
export async function detectPaidProofImage(bytes: Buffer): Promise<PaidProofInput["mime"] | undefined> {
  if (bytes.length < 12 || bytes.length > 4 * 1024 * 1024) return;
  const signature = bytes.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a" && !signature.startsWith("ffd8ff") &&
      !(bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")) return;
  try {
    const raster = sharp(bytes, { limitInputPixels: maxPixels, failOn: "warning", animated: true });
    const { format, width, height, pages } = await raster.metadata();
    if (!format || !Object.hasOwn(mimeTypes, format) || !width || !height ||
        width > 8192 || height > 8192 || width * height > maxPixels || (pages ?? 1) !== 1) return;
    await raster.raw().toBuffer();
    return mimeTypes[format as keyof typeof mimeTypes];
  } catch {
    return;
  }
}
