import type { Request as ExpressRequest } from "express";
import { createYoga } from "graphql-yoga";

import { createGraphQLContext } from "@/server/graphql/context";
import { gqlDebug, gqlLogError } from "@/server/graphql/debug";
import { maskGraphQLError } from "@/server/graphql/map-error";
import { schema } from "@/server/graphql/server";

const isDev = process.env.NODE_ENV !== "production";

function useGraphQLDebugPlugin() {
  return {
    onRequest({ request }: { request: Request }) {
      gqlDebug("request:start", {
        method: request.method,
        url: request.url,
      });
    },
    onParams({
      params,
    }: {
      params: { operationName?: string; query?: string };
    }) {
      gqlDebug("request:params", {
        operationName: params.operationName ?? null,
        queryPreview: params.query?.slice(0, 120) ?? null,
      });
    },
    onExecute() {
      gqlDebug("execute:start");
    },
    onExecuteDone({
      result,
    }: {
      result: { errors?: readonly { message: string }[] };
    }) {
      const errors = result.errors;
      if (errors?.length) {
        gqlLogError("execute:graphql-errors", errors[0], {
          errorCount: errors.length,
          messages: errors.map((e) => e.message),
        });
      } else {
        gqlDebug("execute:done");
      }
    },
    onResponse({ response }: { response: Response }) {
      gqlDebug("request:end", { status: response.status });
    },
  };
}

type YogaExpressServerContext = {
  req?: ExpressRequest;
};

export const yoga = createYoga<YogaExpressServerContext>({
  schema,
  graphqlEndpoint: "/graphql",
  landingPage: isDev,
  context: async ({ req, request }) => {
    gqlDebug("context:create:start");
    try {
      const ctx = await createGraphQLContext(req, request);
      gqlDebug("context:create:done", {
        companyId: ctx.companyId,
        userId: ctx.userId,
        role: ctx.role,
      });
      return ctx;
    } catch (error) {
      gqlLogError("context:create:error", error);
      throw error;
    }
  },
  plugins: [useGraphQLDebugPlugin()],
  maskedErrors: {
    maskError(error, message, dev) {
      gqlLogError("execute:masked-error", error, {
        maskedMessage: message,
        isDev: dev ?? false,
      });
      return maskGraphQLError(error, message, dev ?? false);
    },
  },
});
