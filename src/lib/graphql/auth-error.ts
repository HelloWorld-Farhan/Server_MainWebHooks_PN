import { ClientError } from "graphql-request";

/** Thrown when tenant/org context is missing (401/403). */
export class AuthRequiredError extends Error {
  readonly statusCode: number;

  constructor(message = "Organization context required", statusCode = 401) {
    super(message);
    this.name = "AuthRequiredError";
    this.statusCode = statusCode;
  }
}

const AUTH_STATUS_CODES = new Set([401, 403]);

export function isAuthRequiredError(error: unknown): error is AuthRequiredError {
  return error instanceof AuthRequiredError;
}

export function isUnauthorizedClientError(error: unknown): boolean {
  if (error instanceof ClientError) {
    return AUTH_STATUS_CODES.has(error.response.status);
  }
  if (error instanceof AuthRequiredError) {
    return true;
  }
  return false;
}

/** Shared across pollers in the same browser session. */
let authBlockedForSession = false;

export function isGraphQLAuthBlocked(): boolean {
  return authBlockedForSession;
}

export function markGraphQLAuthBlocked(): void {
  authBlockedForSession = true;
}

export function clearGraphQLAuthBlocked(): void {
  authBlockedForSession = false;
}

export function throwIfAuthBlocked(): void {
  if (authBlockedForSession) {
    throw new AuthRequiredError();
  }
}
