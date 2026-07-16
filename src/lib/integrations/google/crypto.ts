import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function getEncryptionKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is not configured");
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptJson(value: unknown): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

export function decryptJson<T>(payload: string): T {
  const key = getEncryptionKey();
  const buffer = Buffer.from(payload, "base64url");
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export function encryptOAuthState(value: unknown): string {
  try {
    return encryptJson(value);
  } catch {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  }
}

export function decryptOAuthState<T>(payload: string): T {
  try {
    return decryptJson<T>(payload);
  } catch {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  }
}
