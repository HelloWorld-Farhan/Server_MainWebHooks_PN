import type { Request as ExpressRequest } from "express";

import {
  ApiKeyDisabledError,
  ApiKeyExpiredError,
  InvalidApiKeyError,
  InvalidApiKeyFormatError,
} from "@/server/lib/errors";
import {
  extractBearerToken,
  looksLikeApiKey,
  parseApiKey,
  verifyApiKeySecret,
} from "@/server/lib/api-key-crypto";
import { buildApiKeyTenantContext } from "@/server/lib/api-key-tenant-context";
import prisma from "@/server/lib/prisma";
import type { TenantContext } from "@/server/types/context";

function logAuthFailure(
  reason: string,
  meta: Record<string, unknown> = {},
): void {
  console.warn("[api-key:auth:failed]", { reason, ...meta });
}

function getAuthorizationHeader(
  req?: ExpressRequest,
  fetchRequest?: Request,
): string | null {
  if (req) {
    const value = req.get("authorization");
    return value ?? null;
  }
  if (fetchRequest) {
    return fetchRequest.headers.get("authorization");
  }
  return null;
}

export function getApiKeyTokenFromRequest(
  req?: ExpressRequest,
  fetchRequest?: Request,
): string | null {
  const header = getAuthorizationHeader(req, fetchRequest);
  const token = extractBearerToken(header);
  if (!token || !looksLikeApiKey(token)) return null;
  return token;
}

export async function authenticateApiKey(
  plaintext: string,
): Promise<TenantContext> {
  let parsed;
  try {
    parsed = parseApiKey(plaintext);
  } catch (error) {
    logAuthFailure("invalid_format");
    if (error instanceof InvalidApiKeyFormatError) throw error;
    throw new InvalidApiKeyFormatError();
  }

  const apiKey = await prisma.apiKey.findFirst({
    where: {
      keyId: parsed.keyId,
      deletedAt: null,
    },
    include: {
      branchAccess: true,
    },
  });

  if (!apiKey) {
    logAuthFailure("not_found", { keyId: parsed.keyId });
    throw new InvalidApiKeyError();
  }

  if (apiKey.environment !== parsed.environment) {
    logAuthFailure("environment_mismatch", { keyId: parsed.keyId });
    throw new InvalidApiKeyError();
  }

  const primaryValid = verifyApiKeySecret(parsed.secret, apiKey.hashedSecret);
  const previousValid =
    Boolean(apiKey.previousHashedSecret) &&
    Boolean(apiKey.previousSecretExpiresAt) &&
    apiKey.previousSecretExpiresAt! > new Date() &&
    verifyApiKeySecret(parsed.secret, apiKey.previousHashedSecret!);

  if (!primaryValid && !previousValid) {
    logAuthFailure("secret_mismatch", { keyId: parsed.keyId, apiKeyId: apiKey.id });
    throw new InvalidApiKeyError();
  }

  if (apiKey.status !== "ACTIVE") {
    logAuthFailure("disabled", { keyId: parsed.keyId, apiKeyId: apiKey.id });
    throw new ApiKeyDisabledError();
  }

  if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
    logAuthFailure("expired", { keyId: parsed.keyId, apiKeyId: apiKey.id });
    throw new ApiKeyExpiredError();
  }

  // Fire-and-forget lastUsedAt update; do not block auth.
  void prisma.apiKey
    .update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch((error) => {
      console.warn("[api-key:auth:lastUsedAt]", {
        apiKeyId: apiKey.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return buildApiKeyTenantContext(apiKey);
}

/**
 * Reusable auth entrypoint for GraphQL and REST.
 * Returns null when the Authorization header is not an API key bearer token.
 */
export async function tryAuthenticateApiKeyFromRequest(
  req?: ExpressRequest,
  fetchRequest?: Request,
): Promise<TenantContext | null> {
  const token = getApiKeyTokenFromRequest(req, fetchRequest);
  if (!token) return null;
  return authenticateApiKey(token);
}
