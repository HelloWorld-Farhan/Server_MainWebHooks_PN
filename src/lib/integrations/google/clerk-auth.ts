import { clerkClient } from "@/auth/clerk";

import { GOOGLE_OAUTH_SCOPES } from "@/lib/integrations/google/constants";

export type ClerkGoogleToken = {
  accessToken: string;
  scopes: string[];
  expiresAt: number | null;
};

export async function getClerkGoogleAccessToken(
  clerkUserId: string,
): Promise<ClerkGoogleToken | null> {
  try {
    const client = clerkClient;
    const response = await client.users.getUserOauthAccessToken(
      clerkUserId,
      "google",
    );
    const entry = response.data[0];
    if (!entry?.token) return null;

    return {
      accessToken: entry.token,
      scopes: entry.scopes ?? [],
      expiresAt: entry.expiresAt ?? null,
    };
  } catch {
    return null;
  }
}

export function hasRequiredGoogleScopes(scopes: string[]): boolean {
  const normalized = new Set(scopes.map((scope) => scope.toLowerCase()));
  return GOOGLE_OAUTH_SCOPES.every((required) => {
    const short = required.replace("https://www.googleapis.com/auth/", "");
    return (
      normalized.has(required) ||
      normalized.has(short) ||
      normalized.has(`https://www.googleapis.com/auth/${short}`)
    );
  });
}

export async function getClerkGoogleEmail(
  clerkUserId: string,
): Promise<string | null> {
  try {
    const client = clerkClient;
    const user = await client.users.getUser(clerkUserId);
    const googleAccount = user.externalAccounts.find(
      (account) => account.provider === "google",
    );
    return googleAccount?.emailAddress ?? user.primaryEmailAddress?.emailAddress ?? null;
  } catch {
    return null;
  }
}

export async function userHasGoogleAccount(clerkUserId: string): Promise<boolean> {
  try {
    const client = clerkClient;
    const user = await client.users.getUser(clerkUserId);
    return user.externalAccounts.some(
      (account) =>
        account.provider === "google" ||
        account.provider === "oauth_google" ||
        account.provider.includes("google"),
    );
  } catch {
    return false;
  }
}
