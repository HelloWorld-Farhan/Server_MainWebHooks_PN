import { Prisma } from "@prisma/client";
import { GraphQLError } from "graphql";

import { isAppError, type AppError } from "@/server/lib/errors";

function unwrapError(error: unknown): unknown {
  if (error instanceof GraphQLError && error.originalError) {
    return error.originalError;
  }
  if (error instanceof Error && "originalError" in error) {
    const nested = (error as { originalError?: unknown }).originalError;
    if (nested) return nested;
  }
  return error;
}

function isPrismaClientError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  );
}

function toAppGraphQLError(appError: AppError): GraphQLError {
  return new GraphQLError(appError.message, {
    extensions: {
      code: appError.code,
      http: {
        status: appError.statusCode,
        spec: true,
      },
    },
    originalError: appError,
  });
}

function toPrismaGraphQLError(error: Error, isDev: boolean): GraphQLError {
  return new GraphQLError(
    isDev ? error.message : "Database temporarily unavailable",
    {
      extensions: {
        code: "SERVICE_UNAVAILABLE",
        http: {
          status: 503,
          spec: true,
        },
      },
      originalError: error,
    },
  );
}

export function toGraphQLError(error: unknown, isDev: boolean): GraphQLError {
  if (error instanceof GraphQLError) {
    const root = unwrapError(error);
    if (isAppError(root)) {
      return toAppGraphQLError(root);
    }
    if (root instanceof Error && isPrismaClientError(root)) {
      return toPrismaGraphQLError(root, isDev);
    }
    return error;
  }

  const root = unwrapError(error);

  if (isAppError(root)) {
    return toAppGraphQLError(root);
  }

  if (root instanceof Error && isPrismaClientError(root)) {
    return toPrismaGraphQLError(root, isDev);
  }

  if (error instanceof Error) {
    return new GraphQLError(isDev ? error.message : "Internal server error", {
      extensions: {
        code: "INTERNAL_SERVER_ERROR",
        unexpected: true,
        http: {
          status: 500,
        },
      },
      originalError: error,
    });
  }

  return new GraphQLError("Internal server error", {
    extensions: {
      code: "INTERNAL_SERVER_ERROR",
      unexpected: true,
      http: {
        status: 500,
      },
    },
  });
}

export function maskGraphQLError(
  error: unknown,
  message: string,
  isDev: boolean,
): Error {
  const root = unwrapError(error);

  if (isAppError(error) || isAppError(root)) {
    return toAppGraphQLError(isAppError(error) ? error : (root as AppError));
  }

  if (
    (error instanceof Error && isPrismaClientError(error)) ||
    (root instanceof Error && isPrismaClientError(root))
  ) {
    return toPrismaGraphQLError(
      root instanceof Error ? root : (error as Error),
      isDev,
    );
  }

  if (error instanceof GraphQLError) {
    return error;
  }

  if (!isDev) {
    return new GraphQLError(message, {
      extensions: {
        code: "INTERNAL_SERVER_ERROR",
        unexpected: true,
        http: {
          status: 500,
        },
      },
    });
  }

  return error instanceof Error ? error : new Error(String(error));
}
