import { createClerkClient } from "@clerk/backend";
import type { Request } from "express";

function getSecretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) {
    throw new Error("CLERK_SECRET_KEY is not configured");
  }
  return key;
}

export const clerkClient = createClerkClient({
  secretKey: getSecretKey(),
});

export type ClerkAuthState = {
  userId: string | null;
  orgId: string | null;
  sessionId: string | null;
};

function authorizedParties(): string[] {
  const parties = [
    process.env.MAIN_WEBSITE_URL,
    process.env.MAIN_SERVER_URL,
    "http://localhost:3000",
    "http://localhost:3004",
  ].filter((value): value is string => Boolean(value));
  return [...new Set(parties)];
}

export async function getAuthFromRequest(
  req: Request,
): Promise<ClerkAuthState> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return { userId: null, orgId: null, sessionId: null };
  }

  const request = new Request(
    `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`,
    {
      method: req.method,
      headers: req.headers as HeadersInit,
    },
  );

  try {
    const result = await clerkClient.authenticateRequest(request, {
      secretKey,
      authorizedParties: authorizedParties(),
    });
    const auth = result.toAuth();
    if (!auth) {
      return { userId: null, orgId: null, sessionId: null };
    }
    return {
      userId: auth.userId,
      orgId: auth.orgId ?? null,
      sessionId: auth.sessionId ?? null,
    };
  } catch {
    return { userId: null, orgId: null, sessionId: null };
  }
}
