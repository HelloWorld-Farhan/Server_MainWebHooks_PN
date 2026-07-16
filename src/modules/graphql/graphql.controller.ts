import { All, Controller, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { runWithRequest } from "@/auth/request-context";
import { yoga } from "@/server/graphql/yoga";

@Controller()
export class GraphQLController {
  @All("graphql")
  @All("api/graphql")
  async handleGraphQL(@Req() req: Request, @Res() res: Response) {
    return runWithRequest(req, () => {
      return yoga(req, res);
    });
  }
}
