import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const envelope = Buffer.from("FBSP1");

function proofKey() {
  const value = process.env.PAID_PROOF_ENCRYPTION_KEY?.trim() ?? "";
  return /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, "hex") : undefined;
}

export function paidProofEncryptionConfigured() {
  return proofKey() !== undefined;
}

export function encryptPaidProof(content: Buffer, context: string) {
  const key = proofKey();
  if (!key) throw new Error("Paid proof encryption key is not configured");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
  return Buffer.concat([envelope, nonce, cipher.getAuthTag(), encrypted]);
}

export function decryptPaidProof(content: Buffer, context: string) {
  const key = proofKey();
  if (!key) throw new Error("Paid proof encryption key is not configured");
  if (!content.subarray(0, 5).equals(envelope) || content.length < 34) throw new Error("Invalid paid proof envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, content.subarray(5, 17));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(content.subarray(17, 33));
  return Buffer.concat([decipher.update(content.subarray(33)), decipher.final()]);
}
