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

function headerPresence(value: string | undefined): "present" | "missing" {
  return value ? "present" : "missing";
}

function logAuthRequestSnapshot(req: Request): void {
  console.log("[clerk:pre-auth]", {
    method: req.method,
    url: buildClerkRequestUrl(req),
    host: req.get("host"),
    origin: req.get("origin"),
    referer: req.get("referer"),
    cookie: headerPresence(req.get("cookie")),
    authorization: headerPresence(req.get("authorization")),
    x_forwarded_host: req.get("x-forwarded-host"),
    x_forwarded_proto: req.get("x-forwarded-proto"),
    x_forwarded_for: req.get("x-forwarded-for"),
    authorizedParties: authorizedParties(),
  });
}

function logFetchAuthRequestSnapshot(request: globalThis.Request): void {
  console.log("[clerk:pre-auth]", {
    method: request.method,
    url: request.url,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    cookie: headerPresence(request.headers.get("cookie") ?? undefined),
    authorization: headerPresence(request.headers.get("authorization") ?? undefined),
    x_forwarded_host: request.headers.get("x-forwarded-host"),
    x_forwarded_proto: request.headers.get("x-forwarded-proto"),
    x_forwarded_for: request.headers.get("x-forwarded-for"),
    authorizedParties: authorizedParties(),
  });
}

function logAuthError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "Error";
  console.error("[clerk:auth-error]", { name, message });
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

    console.log("[clerk:post-auth]", {
      status: result.status,
      isAuthenticated: result.isAuthenticated,
      userId: auth?.userId ?? null,
      sessionId: auth?.sessionId ?? null,
      orgId: auth?.orgId ?? null,
      actor: auth?.actor ?? null,
      reason: result.status === "signed-out" ? "signed-out" : undefined,
    });

    if (!auth) {
      return { userId: null, orgId: null, sessionId: null };
    }
    return {
      userId: auth.userId,
      orgId: auth.orgId ?? null,
      sessionId: auth.sessionId ?? null,
    };
  } catch (error) {
    logAuthError(error);
    return { userId: null, orgId: null, sessionId: null };
  }
}

export async function getAuthFromFetchRequest(
  request: globalThis.Request,
): Promise<ClerkAuthState> {
  logFetchAuthRequestSnapshot(request);
  return authenticateClerkRequest(request);
}

export async function getAuthFromRequest(
  req: Request,
): Promise<ClerkAuthState> {
  logAuthRequestSnapshot(req);

  const request = new Request(buildClerkRequestUrl(req), {
    method: req.method,
    headers: req.headers as HeadersInit,
  });

  return authenticateClerkRequest(request);
}
