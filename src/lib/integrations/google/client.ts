import { google } from "googleapis";

import {
  isGoogleIntegrationAuthorized,
  resolveGoogleClerkUserId,
} from "@/lib/integrations/google/auth-status";
import { getClerkGoogleAccessToken } from "@/lib/integrations/google/clerk-auth";
import { getOAuthClient } from "@/lib/integrations/google/oauth-client";
import {
  getGoogleTokens,
  saveGoogleTokens,
  type GoogleTokenSet,
} from "@/lib/integrations/google/token-store";
import type { TenantContext } from "@/server/types/context";

export class GoogleSheetsScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleSheetsScopeError";
  }
}

export async function ensureGoogleSheetsAuthorized(
  ctx: TenantContext,
): Promise<void> {
  const authorized = await isGoogleIntegrationAuthorized(ctx);
  if (!authorized) {
    throw new GoogleSheetsScopeError(
      "Google Sheets API: missing scopes — reconnect Google via Settings (Integrations → Google Sheets) with full permissions",
    );
  }
}

async function refreshStoredTokensIfNeeded(
  ctx: TenantContext,
  tokens: GoogleTokenSet,
): Promise<GoogleTokenSet> {
  const oauth2 = getOAuthClient();
  oauth2.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expiry_date: tokens.expiryDate ?? undefined,
    scope: tokens.scope,
    token_type: tokens.tokenType,
  });

  const isExpired =
    tokens.expiryDate !== null &&
    tokens.expiryDate !== undefined &&
    Date.now() >= tokens.expiryDate - 60_000;

  if (!isExpired && tokens.accessToken) {
    return tokens;
  }

  const { credentials } = await oauth2.refreshAccessToken();
  const next: GoogleTokenSet = {
    accessToken: credentials.access_token ?? tokens.accessToken,
    refreshToken: credentials.refresh_token ?? tokens.refreshToken,
    expiryDate: credentials.expiry_date ?? null,
    scope: credentials.scope ?? tokens.scope,
    tokenType: credentials.token_type ?? tokens.tokenType,
    email: tokens.email,
  };
  await saveGoogleTokens(ctx, next);
  return next;
}

async function authFromClerk(clerkUserId: string) {
  const clerkToken = await getClerkGoogleAccessToken(clerkUserId);
  if (!clerkToken) return null;

  const oauth2 = getOAuthClient();
  oauth2.setCredentials({
    access_token: clerkToken.accessToken,
    expiry_date: clerkToken.expiresAt ?? undefined,
  });
  return oauth2;
}

export async function getGoogleAuthClient(ctx: TenantContext) {
  const stored = await getGoogleTokens(ctx);
  if (stored) {
    const refreshed = await refreshStoredTokensIfNeeded(ctx, stored);
    const oauth2 = getOAuthClient();
    oauth2.setCredentials({
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      expiry_date: refreshed.expiryDate ?? undefined,
      scope: refreshed.scope,
      token_type: refreshed.tokenType,
    });
    return oauth2;
  }

  const clerkUserId = (await resolveGoogleClerkUserId(ctx)) ?? ctx.clerkUserId;
  if (clerkUserId) {
    const clerkAuth = await authFromClerk(clerkUserId);
    if (clerkAuth) return clerkAuth;
  }

  throw new Error(
    "Google account is not connected. Link Google in your Clerk account or connect via Settings.",
  );
}

export async function getSheetsClient(ctx: TenantContext) {
  const auth = await getGoogleAuthClient(ctx);
  return google.sheets({ version: "v4", auth });
}

export async function getDriveClient(ctx: TenantContext) {
  const auth = await getGoogleAuthClient(ctx);
  return google.drive({ version: "v3", auth });
}

export async function getCalendarClient(ctx: TenantContext) {
  const auth = await getGoogleAuthClient(ctx);
  return google.calendar({ version: "v3", auth });
}
