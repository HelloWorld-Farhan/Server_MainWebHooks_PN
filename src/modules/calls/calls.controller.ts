import {
  Controller,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { handleTenantResult } from "@/lib/api/http";
import { requireTenantPermission } from "@/lib/api/tenant-context";
import { PERMISSIONS } from "@/lib/permissions";
import { isAppError } from "@/server/lib/errors";
import { outboundCallsService } from "@/server/services/outbound-calls.service";

const createOutboundCallSchema = z.object({
  campaignId: z.string().min(1),
  phoneNumber: z.string().min(1),
});

@Controller("api/calls")
export class CallsController {
  @Post("outbound")
  async createOutbound(@Req() req: Request, @Res() res: Response) {
    const result = await requireTenantPermission(
      req,
      PERMISSIONS.CALL_LOGS_WRITE,
    );
    if (!handleTenantResult(res, result) || !result.ctx) return;

    try {
      const body = createOutboundCallSchema.parse(req.body);
      const response = await outboundCallsService.createOutboundCall(
        result.ctx,
        body,
      );
      return res.json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ error: err.issues[0]?.message ?? err.message });
      }
      if (isAppError(err)) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
