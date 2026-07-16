type ClerkApiErrorShape = {
  errors?: { code?: string }[];
  status?: number;
  retryAfter?: number;
  headers?: { get?: (name: string) => string | null };
};

export function isClerkOrganizationsDisabled(error: unknown): boolean {
  const err = error as ClerkApiErrorShape;
  return (
    err.errors?.some(
      (e) => e.code === "organization_not_enabled_in_instance",
    ) ?? false
  );
}

export function isClerkNotFound(error: unknown): boolean {
  const err = error as ClerkApiErrorShape;
  return err.status === 404;
}

export function isClerkRateLimited(error: unknown): boolean {
  const err = error as ClerkApiErrorShape;
  return err.status === 429;
}

export function getClerkRetryAfter(error: unknown): number {
  const err = error as ClerkApiErrorShape;
  if (typeof err.retryAfter === "number" && err.retryAfter > 0) {
    return err.retryAfter * 1000;
  }

  const headerValue = err.headers?.get?.("retry-after");
  if (headerValue) {
    const seconds = Number.parseInt(headerValue, 10);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }

  return 1000;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
