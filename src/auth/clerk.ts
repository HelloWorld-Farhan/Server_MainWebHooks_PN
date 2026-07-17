import { createClerkClient } from "@clerk/backend";
import type { Request } from "express";

function getSecretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) {
    throw new Error("CLERK_SECRET_KEY is not configured");
  }
  return key;
}

function getPublishableKey(): string {
  const key =
    process.env.CLERK_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error(
      "CLERK_PUBLISHABLE_KEY or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not configured",
    );
  }
  return key;
}

export const clerkClient = createClerkClient({
  secretKey: getSecretKey(),
  publishableKey: getPublishableKey(),
});

export type ClerkAuthState = {
  userId: string | null;
  orgId: string | null;
  sessionId: string | null;
};

function normalizeOrigin(value: string): string {
  return value.replace(/\/$/, "");
}

function authorizedParties(): string[] {
  const parties = [
    process.env.MAIN_WEBSITE_URL,
    process.env.MAIN_SERVER_URL,
    "http://localhost:3000",
    "http://localhost:3004",
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeOrigin);

  return [...new Set(parties)];
}

function buildClerkRequestUrl(req: Request): string {
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${host}${req.originalUrl}`;
}

async function authenticateClerkRequest(
  request: globalThis.Request,
): Promise<ClerkAuthState> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return { userId: null, orgId: null, sessionId: null };
  }

  try {
    const result = await clerkClient.authenticateRequest(request, {
      secretKey,
      publishableKey: getPublishableKey(),
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
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[clerk] authenticateRequest failed:", error);
    }
    return { userId: null, orgId: null, sessionId: null };
  }
}

export async function getAuthFromFetchRequest(
  request: globalThis.Request,
): Promise<ClerkAuthState> {
  return authenticateClerkRequest(request);
}

export async function getAuthFromRequest(
  req: Request,
): Promise<ClerkAuthState> {
  const request = new Request(buildClerkRequestUrl(req), {
    method: req.method,
    headers: req.headers as HeadersInit,
  });

  return authenticateClerkRequest(request);
}
