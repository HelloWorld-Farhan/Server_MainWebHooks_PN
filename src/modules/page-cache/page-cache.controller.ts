import {
  All,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { runWithRequest } from "@/auth/request-context";
import { toFetchRequest } from "@/lib/api/express-request";
import { handleTenantResult } from "@/lib/api/http";
import { requireTenantContext } from "@/lib/api/tenant-context";
import { createGraphQLContext } from "@/server/graphql/context";
import { isAppError } from "@/server/lib/errors";
import { cacheKeys } from "@/server/cache/keys";
import { pageCacheService } from "@/server/cache/page-cache.service";
import { parsePageCacheParams } from "@/server/page-cache/parse-params";
import {
  getPageLoader,
  isValidPageCacheKey,
} from "@/server/page-cache/registry";

@Controller("api/page-cache")
export class PageCacheController {
  @Get(":pageKey")
  async getPageCache(
    @Req() req: Request,
    @Res() res: Response,
    @Param("pageKey") pageKey: string,
  ) {
    if (!isValidPageCacheKey(pageKey)) {
      return res.status(404).json({ error: "Unknown page key" });
    }

    return runWithRequest(req, async () => {
      try {
        const gqlContext = await createGraphQLContext();
        const loader = getPageLoader(pageKey);
        if (!loader) {
          return res.status(404).json({ error: "Page loader not found" });
        }

        const params = parsePageCacheParams(
          new URL(
            `${req.protocol}://${req.get("host")}${req.originalUrl}`,
          ).searchParams,
        );
        const cacheKey = cacheKeys.page(
          gqlContext.companyId,
          pageKey,
          params,
        );

        const result = await pageCacheService.getPageData(cacheKey, () =>
          loader(toFetchRequest(req), params),
        );

        return res.json(result);
      } catch (error) {
        if (isAppError(error)) {
          return res.status(error.statusCode).json({ error: error.message });
        }
        const message =
          error instanceof Error ? error.message : "Failed to load page cache";
        return res.status(500).json({ error: message });
      }
    });
  }
}
