import { ClientError, GraphQLClient } from "graphql-request";

import {
  AuthRequiredError,
  isUnauthorizedClientError,
  markGraphQLAuthBlocked,
  throwIfAuthBlocked,
} from "@/lib/graphql/auth-error";

const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

function toOrigin(base: string): string {
  return base.startsWith("http") ? base : `https://${base}`;
}

function getGraphQLEndpoint() {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/graphql`;
  }

  // On Vercel, prefer the auto-injected hostname over a localhost build-time URL.
  if (process.env.VERCEL_URL) {
    return `${toOrigin(process.env.VERCEL_URL)}/api/graphql`;
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${toOrigin(base)}/api/graphql`;
}

function createFetchWithTimeout(timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

export function createGraphQLClient() {
  return new GraphQLClient(getGraphQLEndpoint(), {
    credentials: "include",
    fetch: createFetchWithTimeout(),
  });
}

export const graphqlClient = createGraphQLClient();

export async function gqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  throwIfAuthBlocked();

  try {
    return await graphqlClient.request<T>(query, variables);
  } catch (error) {
    if (isUnauthorizedClientError(error)) {
      markGraphQLAuthBlocked();
      const status =
        error instanceof ClientError ? error.response.status : 401;
      const message =
        error instanceof ClientError
          ? (error.response.errors?.[0]?.message ??
            "Organization context required")
          : "Organization context required";
      throw new AuthRequiredError(message, status);
    }
    throw error;
  }
}
