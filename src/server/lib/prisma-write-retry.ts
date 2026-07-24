import { Prisma } from "@prisma/client";

const DEFAULT_MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 50;

export function isPrismaWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries MongoDB write-conflict errors (Prisma P2034) with exponential backoff.
 */
export async function withPrismaWriteRetry<T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? BASE_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isPrismaWriteConflict(error) || attempt === maxAttempts) {
        throw error;
      }
      const jitter = Math.random() * baseDelayMs;
      await delay(baseDelayMs * 2 ** (attempt - 1) + jitter);
    }
  }

  throw lastError;
}
