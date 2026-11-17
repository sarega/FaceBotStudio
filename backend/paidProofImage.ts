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

/** Best-effort optimization. Keep the fully decoded original if a re-encode is larger. */
export async function optimizePaidProofImage(
  content: Buffer, mime: PaidProofInput["mime"],
): Promise<{ content: Buffer; mime: PaidProofInput["mime"] }> {
  try {
    const source = sharp(content, { limitInputPixels: maxPixels, failOn: "warning" });
    const meta = await source.metadata();
    if (!meta.width || !meta.height || meta.pages && meta.pages > 1) return { content, mime };
    const resized = () => sharp(content, { limitInputPixels: maxPixels, failOn: "warning" })
      .rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true });
    // Screenshots with sharp text must be lossless, while photographic slips can be JPEG.
    const candidate = mime === "image/png"
      ? await resized().webp({ lossless: true, effort: 4 }).toBuffer()
      : await resized().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    if (candidate.length >= content.length || candidate.length > 4 * 1024 * 1024) {
      return { content, mime };
    }
    return { content: candidate, mime: mime === "image/png" ? "image/webp" : "image/jpeg" };
  } catch {
    return { content, mime };
  }
}
