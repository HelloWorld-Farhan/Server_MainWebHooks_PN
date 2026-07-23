import { All, Controller, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { runWithRequest } from "@/auth/request-context";
import { yoga } from "@/server/graphql/yoga";

const API_GRAPHQL_PREFIX = "/api/graphql";

function normalizeGraphqlRequestPath(req: Request): void {
  if (!req.url.startsWith(API_GRAPHQL_PREFIX)) {
    return;
  }

  req.url = `/graphql${req.url.slice(API_GRAPHQL_PREFIX.length)}`;
}

@Controller()
export class GraphQLController {
  @All("graphql")
  @All("api/graphql")
  async handleGraphQL(@Req() req: Request, @Res() res: Response) {
    return runWithRequest(req, async () => {
      normalizeGraphqlRequestPath(req);
      return yoga(req, res);
    });
  }
}
