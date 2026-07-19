import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { ApiKeyEnvironment } from "@prisma/client";

import { InvalidApiKeyFormatError } from "@/server/lib/errors";

const KEY_ID_BYTES = 12;
const SECRET_BYTES = 32;
const KEY_PREFIX_VISIBLE = 8;

export type GeneratedApiKey = {
  plaintext: string;
  keyId: string;
  keyPrefix: string;
  hashedSecret: string;
  environment: ApiKeyEnvironment;
};

export type ParsedApiKey = {
  environment: ApiKeyEnvironment;
  keyId: string;
  secret: string;
};

function getPepper(): string {
  const pepper =
    process.env.API_KEY_PEPPER ??
    process.env.CLERK_SECRET_KEY ??
    "propnex-dev-api-key-pepper";
  return pepper;
}

export function hashApiKeySecret(secret: string): string {
  return createHmac("sha256", getPepper()).update(secret).digest("hex");
}

export function verifyApiKeySecret(
  secret: string,
  hashedSecret: string,
): boolean {
  const computed = hashApiKeySecret(secret);
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(hashedSecret, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function toHex(buf: Buffer): string {
  return buf.toString("hex");
}

export function generateApiKey(environment: ApiKeyEnvironment): GeneratedApiKey {
  const envSegment = environment === "LIVE" ? "live" : "test";
  const keyId = toHex(randomBytes(KEY_ID_BYTES));
  const secret = toHex(randomBytes(SECRET_BYTES));
  const plaintext = `pnx_sk_${envSegment}_${keyId}_${secret}`;
  const keyPrefix = `pnx_sk_${envSegment}_${keyId.slice(0, KEY_PREFIX_VISIBLE)}`;

  return {
    plaintext,
    keyId,
    keyPrefix,
    hashedSecret: hashApiKeySecret(secret),
    environment,
  };
}

/** Rotate secret while keeping the same public keyId (supports grace-period auth). */
export function rotateApiKeySecret(
  environment: ApiKeyEnvironment,
  keyId: string,
): { plaintext: string; keyPrefix: string; hashedSecret: string } {
  const envSegment = environment === "LIVE" ? "live" : "test";
  const secret = toHex(randomBytes(SECRET_BYTES));
  const plaintext = `pnx_sk_${envSegment}_${keyId}_${secret}`;
  const keyPrefix = `pnx_sk_${envSegment}_${keyId.slice(0, KEY_PREFIX_VISIBLE)}`;
  return {
    plaintext,
    keyPrefix,
    hashedSecret: hashApiKeySecret(secret),
  };
}

export function maskApiKeyPrefix(keyPrefix: string): string {
  return `${keyPrefix}${"•".repeat(12)}`;
}

const API_KEY_PATTERN =
  /^pnx_sk_(live|test)_([a-f0-9]+)_([a-f0-9]+)$/;

export function looksLikeApiKey(token: string): boolean {
  return token.startsWith("pnx_sk_");
}

export function parseApiKey(plaintext: string): ParsedApiKey {
  const match = API_KEY_PATTERN.exec(plaintext.trim());
  if (!match) {
    throw new InvalidApiKeyFormatError();
  }

  const [, envSegment, keyId, secret] = match;
  return {
    environment: envSegment === "live" ? "LIVE" : "TEST",
    keyId,
    secret,
  };
}

export function extractBearerToken(
  authorizationHeader: string | null | undefined,
): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(/\s+/, 2);
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

export const API_KEY_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;
