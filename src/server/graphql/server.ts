import { makeExecutableSchema } from "@graphql-tools/schema";
import type { GraphQLSchema } from "graphql";

import { gqlDebug, gqlLogError } from "@/server/graphql/debug";
import { getDatabaseUrl } from "@/server/lib/database-url";
import { resolvers } from "@/server/resolvers";
import { typeDefs } from "@/server/graphql/type-defs.generated";

function buildSchema(): GraphQLSchema {
  gqlDebug("schema:init:start", {
    typeDefCount: typeDefs.length,
    hasDatabaseUrl: Boolean(getDatabaseUrl()),
    nodeEnv: process.env.NODE_ENV,
  });

  try {
    const built = makeExecutableSchema({
      typeDefs: [...typeDefs],
      resolvers,
    });
    gqlDebug("schema:init:done", { typeDefCount: typeDefs.length });
    return built;
  } catch (error) {
    gqlLogError("schema:init:error", error, { typeDefCount: typeDefs.length });
    throw error;
  }
}

export const schema = buildSchema();
