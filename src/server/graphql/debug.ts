function isGqlTraceEnabled(): boolean {
  if (process.env.GRAPHQL_DEBUG === "0") return false;
  if (process.env.GRAPHQL_DEBUG === "1") return true;
  // Auto-trace on Vercel unless explicitly disabled
  return process.env.VERCEL === "1";
}

function formatError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

export function gqlDebug(label: string, data?: Record<string, unknown>): void {
  if (!isGqlTraceEnabled()) return;
  console.log(`[gql] ${label}`, { ...data, ts: Date.now() });
}

export function gqlLogError(
  label: string,
  error: unknown,
  data?: Record<string, unknown>,
): void {
  const { message, stack } = formatError(error);
  console.error(`[gql] ${label}`, {
    ...data,
    error: message,
    stack,
    ts: Date.now(),
  });
}

export async function gqlDebugTimed<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const trace = isGqlTraceEnabled();
  const start = performance.now();

  if (trace) {
    console.log(`[gql] ${label}:start`, { ts: Date.now() });
  }

  try {
    const result = await fn();
    if (trace) {
      console.log(`[gql] ${label}:done`, {
        ms: Math.round(performance.now() - start),
        ts: Date.now(),
      });
    }
    return result;
  } catch (error) {
    gqlLogError(`${label}:error`, error, {
      ms: Math.round(performance.now() - start),
    });
    throw error;
  }
}
