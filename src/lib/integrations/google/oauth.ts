import { google } from "googleapis";

import {
  GOOGLE_OAUTH_SCOPES,
  isGoogleIntegration,
} from "@/lib/integrations/google/constants";
import {
  decryptOAuthState,
  encryptOAuthState,
} from "@/lib/integrations/google/crypto";
import { getOAuthClient } from "@/lib/integrations/google/oauth-client";
import type { GoogleTokenSet } from "@/lib/integrations/google/token-store";
import type { IntegrationId } from "@/lib/integrations/types";

export type GoogleOAuthState = {
  companyId: string;
  integrationId: IntegrationId;
  nonce: string;
};

export function buildGoogleAuthUrl(
  companyId: string,
  integrationId: IntegrationId,
): string {
  if (!isGoogleIntegration(integrationId)) {
    throw new Error("Not a Google integration");
  }

  const oauth2 = getOAuthClient();
  const state = encryptOAuthState({
    companyId,
    integrationId,
    nonce: crypto.randomUUID(),
  } satisfies GoogleOAuthState);

  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_OAUTH_SCOPES,
    state,
  });
}

export function parseGoogleOAuthState(state: string): GoogleOAuthState {
  const parsed = decryptOAuthState<GoogleOAuthState>(state);
  if (!parsed.companyId || !parsed.integrationId) {
    throw new Error("Invalid OAuth state");
  }
  if (!isGoogleIntegration(parsed.integrationId)) {
    throw new Error("Invalid integration in OAuth state");
  }
  return parsed;
}

export async function exchangeGoogleAuthCode(
  code: string,
): Promise<GoogleTokenSet> {
  const oauth2 = getOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  let email: string | null = null;
  try {
    const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
    const profile = await oauth2Api.userinfo.get();
    email = profile.data.email ?? null;
  } catch {
    email = null;
  }

  if (!tokens.refresh_token && !tokens.access_token) {
    throw new Error("Google did not return OAuth tokens");
  }

  return {
    accessToken: tokens.access_token ?? "",
    refreshToken: tokens.refresh_token ?? "",
    expiryDate: tokens.expiry_date ?? null,
    scope: tokens.scope ?? GOOGLE_OAUTH_SCOPES.join(" "),
    tokenType: tokens.token_type ?? "Bearer",
    email,
  };
}

export async function revokeGoogleToken(refreshToken: string): Promise<void> {
  if (!refreshToken) return;
  const oauth2 = getOAuthClient();
  try {
    await oauth2.revokeToken(refreshToken);
  } catch {
    /* token may already be revoked */
  }
}
