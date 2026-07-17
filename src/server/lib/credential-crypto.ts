import { encryptJson, decryptJson } from "@/lib/integrations/google/crypto";

export function encryptCredentials<T>(value: T): string {
  try {
    return encryptJson(value);
  } catch {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  }
}

export function decryptCredentials<T>(payload: string): T {
  try {
    return decryptJson<T>(payload);
  } catch {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  }
}
